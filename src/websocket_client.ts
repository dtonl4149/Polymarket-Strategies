/**
 * WebSocket Client - Real-time market data (ws package)
 */

import WebSocket from "ws";
import { midPrice } from "../lib/big_calc.js";

export const WSS_MARKET_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
export const WSS_USER_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/user";

export class OrderbookLevel {
  constructor(
    public price: number,
    public size: number
  ) {}
}

export class OrderbookSnapshot {
  asset_id: string;
  market: string;
  timestamp: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  hash: string;

  constructor(
    asset_id: string,
    market: string,
    timestamp: number,
    bids: OrderbookLevel[],
    asks: OrderbookLevel[],
    hash = ""
  ) {
    this.asset_id = asset_id;
    this.market = market;
    this.timestamp = timestamp;
    this.bids = bids;
    this.asks = asks;
    this.hash = hash;
  }

  get best_bid(): number {
    return this.bids[0]?.price ?? 0;
  }

  get best_ask(): number {
    return this.asks[0]?.price ?? 1;
  }

  get mid_price(): number {
    return midPrice(this.best_bid, this.best_ask);
  }

  static fromMessage(msg: Record<string, unknown>): OrderbookSnapshot {
    const bidsRaw = (msg.bids as Array<Record<string, unknown>>) ?? [];
    const asksRaw = (msg.asks as Array<Record<string, unknown>>) ?? [];
    const bids = bidsRaw.map((b) => new OrderbookLevel(Number(b.price), Number(b.size)));
    const asks = asksRaw.map((a) => new OrderbookLevel(Number(a.price), Number(a.size)));
    bids.sort((x, y) => y.price - x.price);
    asks.sort((x, y) => x.price - y.price);
    return new OrderbookSnapshot(
      String(msg.asset_id ?? ""),
      String(msg.market ?? ""),
      Number(msg.timestamp ?? 0),
      bids,
      asks,
      String(msg.hash ?? "")
    );
  }
}

export class PriceChange {
  constructor(
    public asset_id: string,
    public price: number,
    public size: number,
    public side: string,
    public best_bid: number,
    public best_ask: number,
    public hash = ""
  ) {}

  static fromDict(data: Record<string, unknown>): PriceChange {
    return new PriceChange(
      String(data.asset_id ?? ""),
      Number(data.price ?? 0),
      Number(data.size ?? 0),
      String(data.side ?? ""),
      Number(data.best_bid ?? 0),
      Number(data.best_ask ?? 1),
      String(data.hash ?? "")
    );
  }
}

export class LastTradePrice {
  constructor(
    public asset_id: string,
    public market: string,
    public price: number,
    public size: number,
    public side: string,
    public timestamp: number,
    public fee_rate_bps = 0
  ) {}

  static fromMessage(msg: Record<string, unknown>): LastTradePrice {
    return new LastTradePrice(
      String(msg.asset_id ?? ""),
      String(msg.market ?? ""),
      Number(msg.price ?? 0),
      Number(msg.size ?? 0),
      String(msg.side ?? ""),
      Number(msg.timestamp ?? 0),
      Number(msg.fee_rate_bps ?? 0)
    );
  }
}

type BookCallback = (snapshot: OrderbookSnapshot) => void | Promise<void>;
type PriceChangeCallback = (market: string, changes: PriceChange[]) => void | Promise<void>;
type TradeCallback = (trade: LastTradePrice) => void | Promise<void>;
type ErrorCallback = (err: Error) => void;

export class MarketWebSocket {
  url: string;
  reconnect_interval: number;
  ping_interval: number;
  ping_timeout: number;

  private _ws: WebSocket | null = null;
  private _running = false;
  private _subscribed_assets = new Set<string>();
  private _orderbooks: Map<string, OrderbookSnapshot> = new Map();

  private _on_book: BookCallback | null = null;
  private _on_price_change: PriceChangeCallback | null = null;
  private _on_trade: TradeCallback | null = null;
  private _on_error: ErrorCallback | null = null;
  private _on_connect: (() => void) | null = null;
  private _on_disconnect: (() => void) | null = null;

  constructor(
    url = WSS_MARKET_URL,
    reconnect_interval = 5,
    ping_interval = 20,
    ping_timeout = 10
  ) {
    this.url = url;
    this.reconnect_interval = reconnect_interval;
    this.ping_interval = ping_interval;
    this.ping_timeout = ping_timeout;
  }

  get is_connected(): boolean {
    return this._ws !== null && this._ws.readyState === WebSocket.OPEN;
  }

  get orderbooks(): Record<string, OrderbookSnapshot> {
    return Object.fromEntries(this._orderbooks);
  }

  getOrderbook(asset_id: string): OrderbookSnapshot | undefined {
    return this._orderbooks.get(asset_id);
  }

  getMidPrice(asset_id: string): number {
    return this._orderbooks.get(asset_id)?.mid_price ?? 0;
  }

  on_book(cb: BookCallback): BookCallback {
    this._on_book = cb;
    return cb;
  }

  on_price_change(cb: PriceChangeCallback): PriceChangeCallback {
    this._on_price_change = cb;
    return cb;
  }

  on_trade(cb: TradeCallback): TradeCallback {
    this._on_trade = cb;
    return cb;
  }

  on_error(cb: ErrorCallback): ErrorCallback {
    this._on_error = cb;
    return cb;
  }

  on_connect(cb: () => void): () => void {
    this._on_connect = cb;
    return cb;
  }

  on_disconnect(cb: () => void): () => void {
    this._on_disconnect = cb;
    return cb;
  }

  async connect(): Promise<boolean> {
    try {
      this._ws = new WebSocket(this.url);
      await new Promise<void>((resolve, reject) => {
        if (!this._ws) return reject(new Error("no ws"));
        this._ws.once("open", () => resolve());
        this._ws.once("error", (e) => reject(e));
      });
      this._ws.on("message", (raw: WebSocket.RawData) => {
        void (async () => {
          try {
            const text = raw.toString();
            const data = JSON.parse(text) as unknown;
            if (Array.isArray(data)) {
              for (const item of data) await this.handleMessage(item as Record<string, unknown>);
            } else {
              await this.handleMessage(data as Record<string, unknown>);
            }
          } catch (e) {
            if (this._on_error) this._on_error(e as Error);
          }
        })();
      });
      if (this._on_connect) this._on_connect();
      return true;
    } catch (e) {
      if (this._on_error) this._on_error(e as Error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this._running = false;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
      if (this._on_disconnect) this._on_disconnect();
    }
  }

  async subscribe(asset_ids: string[], replace = false): Promise<boolean> {
    if (!asset_ids.length) return false;
    if (replace) {
      this._subscribed_assets.clear();
      this._orderbooks.clear();
    }
    for (const id of asset_ids) this._subscribed_assets.add(id);

    if (!this.is_connected || !this._ws) return true;

    const subscribeMsg = { assets_ids: asset_ids, type: "MARKET" };
    try {
      this._ws.send(JSON.stringify(subscribeMsg));
      return true;
    } catch (e) {
      if (this._on_error) this._on_error(e as Error);
      return false;
    }
  }

  async subscribeMore(asset_ids: string[]): Promise<boolean> {
    if (!asset_ids.length) return false;
    for (const id of asset_ids) this._subscribed_assets.add(id);
    if (!this.is_connected || !this._ws) return true;
    const msg = { assets_ids: asset_ids, operation: "subscribe" };
    try {
      this._ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  async unsubscribe(asset_ids: string[]): Promise<boolean> {
    if (!this.is_connected || !this._ws || !asset_ids.length) return false;
    for (const id of asset_ids) this._subscribed_assets.delete(id);
    const msg = { assets_ids: asset_ids, operation: "unsubscribe" };
    try {
      this._ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private async runCallback<T extends unknown[]>(
    cb: ((...args: T) => void | Promise<void>) | null,
    ...args: T
  ): Promise<void> {
    if (!cb) return;
    try {
      const r = cb(...args);
      if (r && typeof (r as Promise<void>).then === "function") await (r as Promise<void>);
    } catch {
      /* ignore */
    }
  }

  private async handleMessage(data: Record<string, unknown>): Promise<void> {
    const eventType = String(data.event_type ?? "");
    if (eventType === "book") {
      const snapshot = OrderbookSnapshot.fromMessage(data);
      this._orderbooks.set(snapshot.asset_id, snapshot);
      await this.runCallback(this._on_book, snapshot);
    } else if (eventType === "price_change") {
      const market = String(data.market ?? "");
      const pcs = ((data.price_changes as Array<Record<string, unknown>>) ?? []).map((p) =>
        PriceChange.fromDict(p)
      );
      await this.runCallback(this._on_price_change, market, pcs);
    } else if (eventType === "last_trade_price") {
      const trade = LastTradePrice.fromMessage(data);
      await this.runCallback(this._on_trade, trade);
    }
  }

  private async waitUntilClose(): Promise<void> {
    if (!this._ws) return;
    await new Promise<void>((resolve) => {
      this._ws!.once("close", () => resolve());
    });
  }

  async run(auto_reconnect = true): Promise<void> {
    this._running = true;
    while (this._running) {
      if (!(await this.connect())) {
        if (auto_reconnect) await new Promise((r) => setTimeout(r, this.reconnect_interval * 1000));
        else break;
        continue;
      }
      if (this._subscribed_assets.size > 0) {
        await this.subscribe([...this._subscribed_assets]);
      }
      await this.waitUntilClose();
      if (this._on_disconnect) this._on_disconnect();
      if (!this._running) break;
      if (auto_reconnect) await new Promise((r) => setTimeout(r, this.reconnect_interval * 1000));
      else break;
    }
  }

  async runUntilCancelled(): Promise<void> {
    try {
      await this.run(true);
    } finally {
      await this.disconnect();
    }
  }

  stop(): void {
    this._running = false;
  }
}

export class OrderbookManager {
  private _ws = new MarketWebSocket();
  private _price_callback:
    | ((asset_id: string, mid: number, bid: number, ask: number) => void | Promise<void>)
    | null = null;
  private _connected = false;

  constructor() {
    this._ws.on_book(async (snapshot) => {
      if (this._price_callback) {
        await this._price_callback(
          snapshot.asset_id,
          snapshot.mid_price,
          snapshot.best_bid,
          snapshot.best_ask
        );
      }
    });
    this._ws.on_connect(() => {
      this._connected = true;
    });
    this._ws.on_disconnect(() => {
      this._connected = false;
    });
  }

  get is_connected(): boolean {
    return this._connected;
  }

  getPrice(asset_id: string): number {
    return this._ws.getMidPrice(asset_id);
  }

  getOrderbook(asset_id: string): OrderbookSnapshot | undefined {
    return this._ws.getOrderbook(asset_id);
  }

  on_price_update(
    cb: (asset_id: string, mid: number, bid: number, ask: number) => void | Promise<void>
  ): typeof cb {
    this._price_callback = cb;
    return cb;
  }

  async start(asset_ids: string[]): Promise<void> {
    await this._ws.subscribe(asset_ids);
    await this._ws.run(true);
  }

  async subscribe(asset_ids: string[]): Promise<boolean> {
    return this._ws.subscribeMore(asset_ids);
  }

  async unsubscribe(asset_ids: string[]): Promise<boolean> {
    return this._ws.unsubscribe(asset_ids);
  }

  stop(): void {
    this._ws.stop();
  }

  async close(): Promise<void> {
    await this._ws.disconnect();
  }
}
