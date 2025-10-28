/**
 * Price Tracker - Price history and flash crash detection
 */

import { absoluteDrop, dropPercent, minus } from "./big_calc.js";

export class PricePoint {
  constructor(
    public timestamp: number,
    public price: number,
    public side: string
  ) {}
}

export class FlashCrashEvent {
  constructor(
    public side: string,
    public old_price: number,
    public new_price: number,
    public drop: number,
    public timestamp: number
  ) {}

  get dropPercent(): number {
    return dropPercent(this.old_price, this.new_price);
  }
}

export class PriceTracker {
  lookback_seconds = 10;
  drop_threshold = 0.3;
  max_history = 100;

  private _history: Record<string, PricePoint[]> = {
    up: [],
    down: [],
  };

  record(side: string, price: number, timestamp?: number): void {
    if (!(side in this._history)) return;
    if (price <= 0) return;
    const ts = timestamp ?? Date.now() / 1000;
    const arr = this._history[side]!;
    arr.push(new PricePoint(ts, price, side));
    if (arr.length > this.max_history) arr.shift();
  }

  recordPrices(prices: Record<string, number>): void {
    const now = Date.now() / 1000;
    for (const [side, price] of Object.entries(prices)) this.record(side, price, now);
  }

  getHistory(side: string): PricePoint[] {
    return [...(this._history[side] ?? [])];
  }

  getHistoryCount(side: string): number {
    return this._history[side]?.length ?? 0;
  }

  getCurrentPrice(side: string): number {
    const arr = this._history[side];
    if (!arr?.length) return 0;
    return arr[arr.length - 1]!.price;
  }

  getPriceAt(side: string, seconds_ago: number): number | null {
    const arr = this._history[side];
    if (!arr) return null;
    const now = Date.now() / 1000;
    const target = now - seconds_ago;
    for (const point of arr) {
      if (point.timestamp >= target) return point.price;
    }
    return null;
  }

  detectFlashCrash(side?: string | null): FlashCrashEvent | null {
    const sides = side ? [side] : ["up", "down"];
    const now = Date.now() / 1000;
    for (const s of sides) {
      const history = this._history[s];
      if (!history || history.length < 2) continue;
      const current_price = history[history.length - 1]!.price;
      let old_price: number | null = null;
      for (const point of history) {
        if (now - point.timestamp <= this.lookback_seconds) {
          old_price = point.price;
          break;
        }
      }
      if (old_price === null) continue;
      const drop = absoluteDrop(old_price, current_price);
      if (drop >= this.drop_threshold) {
        return new FlashCrashEvent(s, old_price, current_price, drop, now);
      }
    }
    return null;
  }

  detectAllCrashes(): FlashCrashEvent[] {
    const events: FlashCrashEvent[] = [];
    for (const s of ["up", "down"]) {
      const e = this.detectFlashCrash(s);
      if (e) events.push(e);
    }
    return events;
  }

  clear(side?: string | null): void {
    if (side) {
      if (this._history[side]) this._history[side] = [];
    } else {
      this._history.up = [];
      this._history.down = [];
    }
  }

  getPriceRange(side: string, seconds: number): [number, number] {
    const arr = this._history[side];
    if (!arr) return [0, 0];
    const now = Date.now() / 1000;
    const cutoff = now - seconds;
    const prices = arr.filter((p) => p.timestamp >= cutoff).map((p) => p.price);
    if (!prices.length) return [0, 0];
    return [Math.min(...prices), Math.max(...prices)];
  }

  getVolatility(side: string, seconds: number): number {
    const [min, max] = this.getPriceRange(side, seconds);
    return minus(max, min);
  }
}
