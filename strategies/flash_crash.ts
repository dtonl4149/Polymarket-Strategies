/**
 * Flash Crash Strategy
 */

import { Colors, formatCountdown } from "../lib/console.js";
import { BaseStrategy, StrategyConfig } from "./base.js";
import { TradingBot } from "../src/bot.js";
import type { OrderbookSnapshot } from "../src/websocket_client.js";

export class FlashCrashConfig extends StrategyConfig {
  drop_threshold = 0.3;
}

export class FlashCrashStrategy extends BaseStrategy {
  flashConfig: FlashCrashConfig;

  constructor(bot: TradingBot, config: FlashCrashConfig) {
    super(bot, config);
    this.flashConfig = config;
    this.prices.drop_threshold = config.drop_threshold;
  }

  async onBookUpdate(_snapshot: OrderbookSnapshot): Promise<void> {
    /* price recording in base */
  }

  async onTick(prices: Record<string, number>): Promise<void> {
    if (!this.positions.canOpenPosition) return;
    const event = this.prices.detectFlashCrash();
    if (event) {
      this.logMsg(
        `FLASH CRASH: ${event.side.toUpperCase()} drop ${event.drop.toFixed(2)} (${event.old_price.toFixed(2)} -> ${event.new_price.toFixed(2)})`,
        "trade"
      );
      const currentPrice = prices[event.side] ?? 0;
      if (currentPrice > 0) await this.executeBuy(event.side, currentPrice);
    }
  }

  renderStatus(prices: Record<string, number>): void {
    const lines: string[] = [];
    const wsStatus = this.isConnected
      ? `${Colors.GREEN}WS${Colors.RESET}`
      : `${Colors.RED}REST${Colors.RESET}`;
    const countdown = this.getCountdownStr();
    const stats = this.positions.getStats();

    lines.push(`${Colors.BOLD}${"=".repeat(80)}${Colors.RESET}`);
    lines.push(
      `${Colors.CYAN}[${this.config.coin}]${Colors.RESET} [${wsStatus}] Ends: ${countdown} | Trades: ${stats["trades_closed"]} | PnL: $${stats["total_pnl"] >= 0 ? "+" : ""}${stats["total_pnl"].toFixed(2)}`
    );
    lines.push(`${Colors.BOLD}${"=".repeat(80)}${Colors.RESET}`);

    const upOb = this.market.getOrderbook("up");
    const downOb = this.market.getOrderbook("down");

    lines.push(
      `${Colors.GREEN}${"UP".padStart(39)}${Colors.RESET}|${Colors.RED}${"DOWN".padStart(39)}${Colors.RESET}`
    );
    lines.push(
      `${"Bid".padStart(9)} ${"Size".padStart(9)} | ${"Ask".padStart(9)} ${"Size".padStart(9)}|${"Bid".padStart(9)} ${"Size".padStart(9)} | ${"Ask".padStart(9)} ${"Size".padStart(9)}`
    );
    lines.push("-".repeat(80));

    const upBids = upOb?.bids.slice(0, 5) ?? [];
    const upAsks = upOb?.asks.slice(0, 5) ?? [];
    const downBids = downOb?.bids.slice(0, 5) ?? [];
    const downAsks = downOb?.asks.slice(0, 5) ?? [];

    for (let i = 0; i < 5; i++) {
      const ub =
        i < upBids.length
          ? `${upBids[i]!.price.toFixed(4).padStart(9)} ${upBids[i]!.size.toFixed(1).padStart(9)}`
          : `${"--".padStart(9)} ${"--".padStart(9)}`;
      const ua =
        i < upAsks.length
          ? `${upAsks[i]!.price.toFixed(4).padStart(9)} ${upAsks[i]!.size.toFixed(1).padStart(9)}`
          : `${"--".padStart(9)} ${"--".padStart(9)}`;
      const db =
        i < downBids.length
          ? `${downBids[i]!.price.toFixed(4).padStart(9)} ${downBids[i]!.size.toFixed(1).padStart(9)}`
          : `${"--".padStart(9)} ${"--".padStart(9)}`;
      const da =
        i < downAsks.length
          ? `${downAsks[i]!.price.toFixed(4).padStart(9)} ${downAsks[i]!.size.toFixed(1).padStart(9)}`
          : `${"--".padStart(9)} ${"--".padStart(9)}`;
      lines.push(`${ub} | ${ua}|${db} | ${da}`);
    }

    lines.push("-".repeat(80));

    const upMid = upOb?.mid_price ?? prices["up"] ?? 0;
    const downMid = downOb?.mid_price ?? prices["down"] ?? 0;
    const upSpread = this.market.getSpread("up");
    const downSpread = this.market.getSpread("down");

    lines.push(
      `Mid: ${Colors.GREEN}${upMid.toFixed(4)}${Colors.RESET}  Spread: ${upSpread.toFixed(4)}           |Mid: ${Colors.RED}${downMid.toFixed(4)}${Colors.RESET}  Spread: ${downSpread.toFixed(4)}`
    );

    const upHistory = this.prices.getHistoryCount("up");
    const downHistory = this.prices.getHistoryCount("down");
    lines.push(
      `History: UP=${upHistory}/100 DOWN=${downHistory}/100 | Drop threshold: ${this.flashConfig.drop_threshold.toFixed(2)} in ${this.config.price_lookback_seconds}s`
    );

    lines.push(`${Colors.BOLD}${"=".repeat(80)}${Colors.RESET}`);

    lines.push(`${Colors.BOLD}Open Orders:${Colors.RESET}`);
    if (this.openOrders.length) {
      for (const order of this.openOrders.slice(0, 5)) {
        const side = String(order["side"] ?? "?");
        const price = Number(order["price"] ?? 0);
        const size = Number(order["original_size"] ?? order["size"] ?? 0);
        const filled = Number(order["size_matched"] ?? 0);
        const orderId = String(order["id"] ?? "").slice(0, 8);
        const token = String(order["asset_id"] ?? "");
        let tokenSide = "?";
        if (token === this.tokenIds["up"]) tokenSide = "UP";
        else if (token === this.tokenIds["down"]) tokenSide = "DOWN";
        const color = side === "BUY" ? Colors.GREEN : Colors.RED;
        lines.push(
          `  ${color}${side.padEnd(4)}${Colors.RESET} ${tokenSide.padEnd(4)} @ ${price.toFixed(4)} Size: ${size.toFixed(1)} Filled: ${filled.toFixed(1)} ID: ${orderId}...`
        );
      }
    } else {
      lines.push(`  ${Colors.CYAN}(no open orders)${Colors.RESET}`);
    }

    lines.push(`${Colors.BOLD}Positions:${Colors.RESET}`);
    const allPositions = this.positions.getAllPositions();
    if (allPositions.length) {
      for (const pos of allPositions) {
        const current = prices[pos.side] ?? 0;
        const pnl = pos.getPnl(current);
        const pnlPct = pos.getPnlPercent(current);
        const holdTime = pos.getHoldTime();
        const color = pnl >= 0 ? Colors.GREEN : Colors.RED;
        lines.push(
          `  ${Colors.BOLD}${pos.side.toUpperCase().padEnd(4)}${Colors.RESET} Entry: ${pos.entry_price.toFixed(4)} | Current: ${current.toFixed(4)} | Size: $${pos.size.toFixed(2)} | PnL: ${color}$${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)${Colors.RESET} | Hold: ${holdTime.toFixed(0)}s`
        );
        lines.push(
          `       TP: ${pos.take_profit_price.toFixed(4)} (+$${this.config.take_profit.toFixed(2)}) | SL: ${pos.stop_loss_price.toFixed(4)} (-$${this.config.stop_loss.toFixed(2)})`
        );
      }
    } else {
      lines.push(`  ${Colors.CYAN}(no open positions)${Colors.RESET}`);
    }

    if (this._logBuffer.messages.length) {
      lines.push("-".repeat(80));
      lines.push(`${Colors.BOLD}Recent Events:${Colors.RESET}`);
      for (const msg of this._logBuffer.getMessages()) lines.push(`  ${msg}`);
    }

    process.stdout.write("\u001b[H\u001b[J" + lines.join("\n") + "\n");
  }

  private getCountdownStr(): string {
    const market = this.currentMarket;
    if (!market) return "--:--";
    const [mins, secs] = market.getCountdown();
    return formatCountdown(mins, secs);
  }

  onMarketChange(_oldSlug: string, _newSlug: string): void {
    this.prices.clear();
  }
}
