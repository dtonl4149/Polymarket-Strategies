/**
 * Market Manager - Market discovery and WebSocket management
 */

import { GammaClient } from "../src/gamma_client.js";
import { MarketWebSocket, type OrderbookSnapshot } from "../src/websocket_client.js";
import { minus } from "./big_calc.js";

export class MarketInfo {
  slug: string;
  question: string;
  end_date: string;
  token_ids: Record<string, string>;
  prices: Record<string, number>;
  accepting_orders: boolean;

  constructor(
    slug: string,
    question: string,
    end_date: string,
    token_ids: Record<string, string>,
    prices: Record<string, number>,
    accepting_orders: boolean
  ) {
    this.slug = slug;
    this.question = question;
    this.end_date = end_date;
    this.token_ids = token_ids;
    this.prices = prices;
    this.accepting_orders = accepting_orders;
  }

  get upToken(): string {
    return this.token_ids["up"] ?? "";
  }

  get downToken(): string {
    return this.token_ids["down"] ?? "";
  }

  getCountdown(): [number, number] {
    if (!this.end_date) return [-1, -1];
    try {
      const endTime = new Date(this.end_date.replace("Z", "+00:00"));
      const now = new Date();
      const remaining = (endTime.getTime() - now.getTime()) / 1000;
      if (remaining <= 0) return [0, 0];
      const totalSecs = Math.floor(remaining);
      return [Math.floor(totalSecs / 60), totalSecs % 60];
    } catch {
      return [-1, -1];
    }
  }

  getCountdownStr(): string {
    const [mins, secs] = this.getCountdown();
    if (mins < 0) return "--:--";
    if (mins === 0 && secs === 0) return "ENDED";
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  slugTimestamp(): number | null {
    if (!this.slug) return null;
    const ts = this.slug.split("-").pop();
    if (!ts || !/^\d+$/.test(ts)) return null;
    return parseInt(ts, 10);
  }

  endTimestamp(): number | null {
    if (!this.end_date) return null;
    try {
      return Math.floor(new Date(this.end_date.replace("Z", "+00:00")).getTime() / 1000);
    } catch {
      return null;
    }
  }

  isEndingSoon(thresholdSeconds = 60): boolean {
    const [mins, secs] = this.getCountdown();
    if (mins < 0) return false;
    return mins * 60 + secs <= thresholdSeconds;
  }

  hasEnded(): boolean {
    const [mins, secs] = this.getCountdown();
    return mins === 0 && secs === 0;
  }
}

type BookCallback = (snapshot: OrderbookSnapshot) => void | Promise<void>;
type MarketChangeCallback = (oldSlug: string, newSlug: string) => void;
type ConnectionCallback = () => void;

export class MarketManager {
  coin: string;
  market_check_interval: number;
  auto_switch_market: boolean;

  gamma: GammaClient;
  ws: MarketWebSocket | null = null;

  current_market: MarketInfo | null = null;
  private _running = false;
  private _ws_connected = false;
  private _market_check_task: Promise<void> | null = null;

  private _on_book_callbacks: BookCallback[] = [];
  private _on_market_change_callbacks: MarketChangeCallback[] = [];
  private _on_connect_callbacks: ConnectionCallback[] = [];
  private _on_disconnect_callbacks: ConnectionCallback[] = [];

  constructor(coin = "BTC", market_check_interval = 30, auto_switch_market = true) {
    this.coin = coin.toUpperCase();
    this.market_check_interval = market_check_interval;
    this.auto_switch_market = auto_switch_market;
    this.gamma = new GammaClient();
  }

  get isConnected(): boolean {
    return this._ws_connected;
  }

  get isRunning(): boolean {
    return this._running;
  }

  get tokenIds(): Record<string, string> {
    return this.current_market?.token_ids ?? {};
  }

  getOrderbook(side: string): OrderbookSnapshot | undefined {
    if (!this.ws || !this.current_market) return undefined;
    const tokenId = this.current_market.token_ids[side];
    if (!tokenId) return undefined;
    return this.ws.getOrderbook(tokenId);
  }

  getMidPrice(side: string): number {
    return this.getOrderbook(side)?.mid_price ?? 0;
  }

  getBestBid(side: string): number {
    return this.getOrderbook(side)?.best_bid ?? 0;
  }

  getBestAsk(side: string): number {
    return this.getOrderbook(side)?.best_ask ?? 1;
  }

  getSpread(side: string): number {
    const ob = this.getOrderbook(side);
    if (ob && ob.best_bid > 0) return minus(ob.best_ask, ob.best_bid);
    return 0;
  }

  on_book_update(cb: BookCallback): BookCallback {
    this._on_book_callbacks.push(cb);
    return cb;
  }

  on_market_change(cb: MarketChangeCallback): MarketChangeCallback {
    this._on_market_change_callbacks.push(cb);
    return cb;
  }

  on_connect(cb: ConnectionCallback): ConnectionCallback {
    this._on_connect_callbacks.push(cb);
    return cb;
  }

  on_disconnect(cb: ConnectionCallback): ConnectionCallback {
    this._on_disconnect_callbacks.push(cb);
    return cb;
  }

  private updateCurrentMarket(market: MarketInfo): void {
    this.current_market = market;
  }

  private marketSortKey(market: MarketInfo): number | null {
    return market.slugTimestamp() ?? market.endTimestamp();
  }

  private shouldSwitchMarket(oldMarket: MarketInfo | null, newMarket: MarketInfo): boolean {
    if (!oldMarket) return true;
    const oldTokens = new Set(Object.values(oldMarket.token_ids));
    const newTokens = new Set(Object.values(newMarket.token_ids));
    if (setsEqual(newTokens, oldTokens)) return false;
    const oldKey = this.marketSortKey(oldMarket);
    const newKey = this.marketSortKey(newMarket);
    if (oldKey !== null && newKey !== null && newKey <= oldKey) return false;
    return true;
  }

  async discoverMarket(updateState = true): Promise<MarketInfo | null> {
    const marketData = await this.gamma.getMarketInfo(this.coin);
    if (!marketData) return null;
    if (!marketData["accepting_orders"]) return null;

    const market = new MarketInfo(
      String(marketData["slug"] ?? ""),
      String(marketData["question"] ?? ""),
      String(marketData["end_date"] ?? ""),
      (marketData["token_ids"] as Record<string, string>) ?? {},
      (marketData["prices"] as Record<string, number>) ?? {},
      Boolean(marketData["accepting_orders"])
    );

    if (updateState) this.updateCurrentMarket(market);
    return market;
  }

  private async setupWebsocket(): Promise<boolean> {
    if (!this.current_market) return false;
    this.ws = new MarketWebSocket();

    this.ws.on_book(async (snapshot) => {
      for (const callback of this._on_book_callbacks) {
        try {
          const r = callback(snapshot);
          if (r && typeof (r as Promise<void>).then === "function") await (r as Promise<void>);
        } catch {
          /* ignore */
        }
      }
    });

    this.ws.on_connect(() => {
      this._ws_connected = true;
      for (const cb of this._on_connect_callbacks) {
        try {
          cb();
        } catch {
          /* ignore */
        }
      }
    });

    this.ws.on_disconnect(() => {
      this._ws_connected = false;
      for (const cb of this._on_disconnect_callbacks) {
        try {
          cb();
        } catch {
          /* ignore */
        }
      }
    });

    const tokenList = Object.values(this.current_market.token_ids);
    if (tokenList.length) await this.ws.subscribe(tokenList, true);

    return true;
  }

  private async runWebsocket(): Promise<void> {
    if (this.ws) await this.ws.run(true);
  }

  private async marketCheckLoop(): Promise<void> {
    while (this._running) {
      await new Promise((r) => setTimeout(r, this.market_check_interval * 1000));
      if (!this._running) break;

      const oldMarket = this.current_market;
      const oldTokens = new Set(oldMarket ? Object.values(oldMarket.token_ids) : []);
      const oldSlug = oldMarket?.slug ?? null;

      const market = await this.discoverMarket(false);
      if (!market) continue;

      const newTokens = new Set(Object.values(market.token_ids));
      if (setsEqual(newTokens, oldTokens)) {
        this.updateCurrentMarket(market);
        continue;
      }

      if (!(this.auto_switch_market && this.ws)) {
        this.updateCurrentMarket(market);
        continue;
      }

      if (!this.shouldSwitchMarket(oldMarket, market)) continue;

      await this.ws.subscribe([...newTokens], true);
      this.updateCurrentMarket(market);

      if (oldSlug && oldSlug !== market.slug) {
        for (const cb of this._on_market_change_callbacks) {
          try {
            cb(oldSlug, market.slug);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  async start(): Promise<boolean> {
    this._running = true;
    const discovered = await this.discoverMarket();
    if (!discovered) {
      this._running = false;
      return false;
    }

    if (!(await this.setupWebsocket())) {
      this._running = false;
      return false;
    }

    void this.runWebsocket();
    if (this.auto_switch_market) {
      this._market_check_task = this.marketCheckLoop();
    }

    return true;
  }

  async stop(): Promise<void> {
    this._running = false;
    if (this._market_check_task) {
      /* fire-and-forget cancel: loop checks _running */
      await new Promise((r) => setTimeout(r, 0));
    }
    if (this.ws) {
      this.ws.stop();
      await this.ws.disconnect();
      this.ws = null;
    }
    this._ws_connected = false;
  }

  async waitForData(timeout = 5): Promise<boolean> {
    const start = Date.now() / 1000;
    while (Date.now() / 1000 - start < timeout) {
      if (this._ws_connected) {
        if (this.getOrderbook("up") || this.getOrderbook("down")) return true;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async refreshMarket(): Promise<MarketInfo | null> {
    const oldMarket = this.current_market;
    const oldTokens = new Set(oldMarket ? Object.values(oldMarket.token_ids) : []);

    const market = await this.discoverMarket(false);
    if (!market) return null;

    const newTokens = new Set(Object.values(market.token_ids));
    if (setsEqual(newTokens, oldTokens)) {
      this.updateCurrentMarket(market);
      return this.current_market;
    }

    if (!this.shouldSwitchMarket(oldMarket, market)) return oldMarket;

    if (this.ws) await this.ws.subscribe([...newTokens], true);
    this.updateCurrentMarket(market);
    return market;
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
