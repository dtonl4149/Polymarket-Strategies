/**
 * Strategy Base Class
 */

import { LogBuffer, log } from "../lib/console.js";
import { MarketManager, type MarketInfo } from "../lib/market_manager.js";
import { PriceTracker } from "../lib/price_tracker.js";
import { PositionManager, type Position } from "../lib/position_manager.js";
import { TradingBot } from "../src/bot.js";
import type { OrderbookSnapshot } from "../src/websocket_client.js";

export class StrategyConfig {
  coin = "ETH";
  size = 5.0;
  max_positions = 1;
  take_profit = 0.1;
  stop_loss = 0.05;
  market_check_interval = 30.0;
  auto_switch_market = true;
  price_lookback_seconds = 10;
  price_history_size = 100;
  update_interval = 0.1;
  order_refresh_interval = 30.0;
}

export abstract class BaseStrategy {
  bot: TradingBot;
  config: StrategyConfig;
  market: MarketManager;
  prices: PriceTracker;
  positions: PositionManager;

  running = false;
  private _statusMode = false;
  protected _logBuffer: LogBuffer;
  private _cachedOrders: Record<string, unknown>[] = [];
  private _lastOrderRefresh = 0;
  private _orderRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(bot: TradingBot, config: StrategyConfig) {
    this.bot = bot;
    this.config = config;
    this.market = new MarketManager(config.coin, config.market_check_interval, config.auto_switch_market);
    this.prices = new PriceTracker();
    this.prices.lookback_seconds = config.price_lookback_seconds;
    this.prices.max_history = config.price_history_size;
    this.positions = new PositionManager();
    this.positions.take_profit = config.take_profit;
    this.positions.stop_loss = config.stop_loss;
    this.positions.max_positions = config.max_positions;
    this._logBuffer = new LogBuffer(5);
  }

  get isConnected(): boolean {
    return this.market.isConnected;
  }

  get currentMarket(): MarketInfo | null {
    return this.market.current_market;
  }

  get tokenIds(): Record<string, string> {
    return this.market.tokenIds;
  }

  get openOrders(): Record<string, unknown>[] {
    return this._cachedOrders;
  }

  private async doOrderRefresh(): Promise<void> {
    try {
      this._cachedOrders = await this.bot.getOpenOrders();
    } catch {
      /* ignore */
    }
  }

  private maybeRefreshOrders(): void {
    const now = Date.now() / 1000;
    if (now - this._lastOrderRefresh > this.config.order_refresh_interval) {
      this._lastOrderRefresh = now;
      void this.doOrderRefresh();
    }
  }

  logMsg(msg: string, level = "info"): void {
    if (this._statusMode) this._logBuffer.add(msg, level);
    else log(msg, level);
  }

  async start(): Promise<boolean> {
    this.running = true;

    this.market.on_book_update(async (snapshot) => {
      for (const [side, tokenId] of Object.entries(this.tokenIds)) {
        if (tokenId === snapshot.asset_id) {
          this.prices.record(side, snapshot.mid_price);
          break;
        }
      }
      await this.onBookUpdate(snapshot);
    });

    this.market.on_market_change((oldSlug, newSlug) => {
      this.logMsg(`Market changed: ${oldSlug} -> ${newSlug}`, "warning");
      this.prices.clear();
      this.onMarketChange(oldSlug, newSlug);
    });

    this.market.on_connect(() => {
      this.logMsg("WebSocket connected", "success");
      this.onConnect();
    });

    this.market.on_disconnect(() => {
      this.logMsg("WebSocket disconnected", "warning");
      this.onDisconnect();
    });

    if (!(await this.market.start())) {
      this.running = false;
      return false;
    }

    if (!(await this.market.waitForData(5))) {
      this.logMsg("Timeout waiting for market data", "warning");
    }

    return true;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this._orderRefreshTimer) {
      clearInterval(this._orderRefreshTimer);
      this._orderRefreshTimer = null;
    }
    await this.market.stop();
  }

  async run(): Promise<void> {
    try {
      if (!(await this.start())) {
        this.logMsg("Failed to start strategy", "error");
        return;
      }
      this._statusMode = true;

      while (this.running) {
        const prices = this.getCurrentPrices();
        await this.onTick(prices);
        await this.checkExits(prices);
        this.maybeRefreshOrders();
        this.renderStatus(prices);
        await new Promise((r) => setTimeout(r, this.config.update_interval * 1000));
      }
    } catch (e) {
      if (e instanceof Error && e.name === "SIGINT") this.logMsg("Strategy stopped by user");
    } finally {
      await this.stop();
      this.printSummary();
    }
  }

  private getCurrentPrices(): Record<string, number> {
    const prices: Record<string, number> = {};
    for (const side of ["up", "down"]) {
      const p = this.market.getMidPrice(side);
      if (p > 0) prices[side] = p;
    }
    return prices;
  }

  private async checkExits(prices: Record<string, number>): Promise<void> {
    const exits = this.positions.checkAllExits(prices);
    for (const [position, exitType, pnl] of exits) {
      if (exitType === "take_profit") {
        this.logMsg(`TAKE PROFIT: ${position.side.toUpperCase()} PnL: +$${pnl.toFixed(2)}`, "success");
      } else if (exitType === "stop_loss") {
        this.logMsg(`STOP LOSS: ${position.side.toUpperCase()} PnL: $${pnl.toFixed(2)}`, "warning");
      }
      await this.executeSell(position, prices[position.side] ?? 0);
    }
  }

  async executeBuy(side: string, currentPrice: number): Promise<boolean> {
    const tokenId = this.tokenIds[side];
    if (!tokenId) {
      this.logMsg(`No token ID for ${side}`, "error");
      return false;
    }
    const size = this.config.size / currentPrice;
    const buyPrice = Math.min(currentPrice + 0.02, 0.99);
    this.logMsg(`BUY ${side.toUpperCase()} @ ${currentPrice.toFixed(4)} size=${size.toFixed(2)}`, "trade");

    const result = await this.bot.placeOrder(tokenId, buyPrice, size, "BUY");
    if (result.success) {
      this.logMsg(`Order placed: ${result.order_id}`, "success");
      this.positions.openPosition(side, tokenId, currentPrice, size, result.order_id);
      return true;
    }
    this.logMsg(`Order failed: ${result.message}`, "error");
    return false;
  }

  async executeSell(position: Position, currentPrice: number): Promise<boolean> {
    const sellPrice = Math.max(currentPrice - 0.02, 0.01);
    const pnl = position.getPnl(currentPrice);
    const result = await this.bot.placeOrder(position.token_id, sellPrice, position.size, "SELL");
    if (result.success) {
      this.logMsg(`Sell order: ${result.order_id} PnL: $${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`, "success");
      this.positions.closePosition(position.id, pnl);
      return true;
    }
    this.logMsg(`Sell failed: ${result.message}`, "error");
    return false;
  }

  private printSummary(): void {
    this._statusMode = false;
    console.log();
    const stats = this.positions.getStats();
    this.logMsg("Session Summary:");
    this.logMsg(`  Trades: ${stats["trades_closed"]}`);
    this.logMsg(`  Total PnL: $${stats["total_pnl"] >= 0 ? "+" : ""}${stats["total_pnl"].toFixed(2)}`);
    this.logMsg(`  Win rate: ${stats["win_rate"].toFixed(1)}%`);
  }

  abstract onBookUpdate(snapshot: OrderbookSnapshot): Promise<void>;
  abstract onTick(prices: Record<string, number>): Promise<void>;
  abstract renderStatus(prices: Record<string, number>): void;

  onMarketChange(_oldSlug: string, _newSlug: string): void {}
  onConnect(): void {}
  onDisconnect(): void {}
}
