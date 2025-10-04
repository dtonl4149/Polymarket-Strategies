/**
 * Gamma API Client - Market Discovery
 */

import { ThreadLocalSessionMixin } from "./http.js";

export class GammaClient extends ThreadLocalSessionMixin {
  static readonly DEFAULT_HOST = "https://gamma-api.polymarket.com";

  static readonly COIN_SLUGS: Record<string, string> = {
    BTC: "btc-updown-15m",
    ETH: "eth-updown-15m",
    SOL: "sol-updown-15m",
    XRP: "xrp-updown-15m",
  };

  host: string;
  timeout: number;

  constructor(host = GammaClient.DEFAULT_HOST, timeout = 10) {
    super();
    this.host = host.replace(/\/+$/, "");
    this.timeout = timeout;
  }

  async getMarketBySlug(slug: string): Promise<Record<string, unknown> | null> {
    const url = `${this.host}/markets/slug/${slug}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeout * 1000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (res.status === 200) return (await res.json()) as Record<string, unknown>;
      return null;
    } catch {
      clearTimeout(t);
      return null;
    }
  }

  async getCurrent15mMarket(coin: string): Promise<Record<string, unknown> | null> {
    const c = coin.toUpperCase();
    if (!GammaClient.COIN_SLUGS[c]) {
      throw new Error(`Unsupported coin: ${coin}. Use: ${Object.keys(GammaClient.COIN_SLUGS).join(", ")}`);
    }
    const prefix = GammaClient.COIN_SLUGS[c];
    const now = new Date();
    const minute = Math.floor(now.getUTCMinutes() / 15) * 15;
    const currentWindow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), minute, 0, 0)
    );
    const currentTs = Math.floor(currentWindow.getTime() / 1000);

    let slug = `${prefix}-${currentTs}`;
    let market = await this.getMarketBySlug(slug);
    if (market && market.acceptingOrders) return market;

    const nextTs = currentTs + 900;
    slug = `${prefix}-${nextTs}`;
    market = await this.getMarketBySlug(slug);
    if (market && market.acceptingOrders) return market;

    const prevTs = currentTs - 900;
    slug = `${prefix}-${prevTs}`;
    market = await this.getMarketBySlug(slug);
    if (market && market.acceptingOrders) return market;

    return null;
  }

  async getNext15mMarket(coin: string): Promise<Record<string, unknown> | null> {
    const c = coin.toUpperCase();
    if (!GammaClient.COIN_SLUGS[c]) throw new Error(`Unsupported coin: ${coin}`);
    const prefix = GammaClient.COIN_SLUGS[c];
    const now = new Date();
    let minute = (Math.floor(now.getUTCMinutes() / 15) + 1) * 15;
    let nextWindow: Date;
    if (minute >= 60) {
      nextWindow = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1, 0, 0, 0)
      );
    } else {
      nextWindow = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), minute, 0, 0)
      );
    }
    const nextTs = Math.floor(nextWindow.getTime() / 1000);
    const slug = `${prefix}-${nextTs}`;
    return this.getMarketBySlug(slug);
  }

  parseTokenIds(market: Record<string, unknown>): Record<string, string> {
    const clobTokenIds = market.clobTokenIds ?? "[]";
    const tokenIds = GammaClient.parseJsonField(clobTokenIds) as unknown[];
    const outcomes = GammaClient.parseJsonField(market.outcomes ?? '["Up", "Down"]') as unknown[];
    return GammaClient.mapOutcomes(outcomes, tokenIds, (v) => String(v));
  }

  parsePrices(market: Record<string, unknown>): Record<string, number> {
    const outcomePrices = market.outcomePrices ?? '["0.5", "0.5"]';
    const prices = GammaClient.parseJsonField(outcomePrices) as unknown[];
    const outcomes = GammaClient.parseJsonField(market.outcomes ?? '["Up", "Down"]') as unknown[];
    return GammaClient.mapOutcomes(outcomes, prices, (v) => parseFloat(String(v)));
  }

  static parseJsonField(value: unknown): unknown[] {
    if (typeof value === "string") return JSON.parse(value) as unknown[];
    return value as unknown[];
  }

  static mapOutcomes<T>(
    outcomes: unknown[],
    values: unknown[],
    cast: (v: unknown) => T
  ): Record<string, T> {
    const result: Record<string, T> = {};
    for (let i = 0; i < outcomes.length; i++) {
      if (i < values.length) result[String(outcomes[i]).toLowerCase()] = cast(values[i]);
    }
    return result;
  }

  async getMarketInfo(coin: string): Promise<Record<string, unknown> | null> {
    const market = await this.getCurrent15mMarket(coin);
    if (!market) return null;
    const token_ids = this.parseTokenIds(market);
    const prices = this.parsePrices(market);
    return {
      slug: market.slug,
      question: market.question,
      end_date: market["endDate"],
      token_ids,
      prices,
      accepting_orders: market.acceptingOrders ?? false,
      best_bid: market.bestBid,
      best_ask: market.bestAsk,
      spread: market.spread,
      raw: market,
    };
  }
}
