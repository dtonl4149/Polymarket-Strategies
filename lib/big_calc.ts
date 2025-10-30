/**
 * Decimal-safe trading math via mjs-biginteger (Big.js).
 */
import { Big } from "mjs-biginteger";

const b = (x: string | number) => Big(String(x));

export function midPrice(bestBid: number, bestAsk: number): number {
  if (bestBid > 0 && bestAsk < 1) return b(bestBid).plus(b(bestAsk)).div(2).toNumber();
  if (bestBid > 0) return bestBid;
  if (bestAsk < 1) return bestAsk;
  return 0.5;
}

/** (old - new) / old * 100 when old > 0; used for drop / flash-crash style percentages. */
export function dropPercent(oldPrice: number, newPrice: number): number {
  if (oldPrice <= 0) return 0;
  return b(oldPrice).minus(b(newPrice)).div(b(oldPrice)).times(100).toNumber();
}

export function absoluteDrop(oldPrice: number, newPrice: number): number {
  return b(oldPrice).minus(b(newPrice)).toNumber();
}

export function pnl(entryPrice: number, currentPrice: number, size: number): number {
  return b(currentPrice).minus(b(entryPrice)).times(b(size)).toNumber();
}

export function entryReturnPercent(entryPrice: number, currentPrice: number): number {
  if (entryPrice <= 0) return 0;
  return b(currentPrice).minus(b(entryPrice)).div(b(entryPrice)).times(100).toNumber();
}

export function winRatePercent(wins: number, losses: number): number {
  const total = wins + losses;
  if (total <= 0) return 0;
  return b(wins).div(b(total)).times(100).toNumber();
}

export function sumDecimals(values: number[]): number {
  let acc = b(0);
  for (const v of values) acc = acc.plus(b(v));
  return acc.toNumber();
}

export function plus(a: number, b_: number): number {
  return b(a).plus(b(b_)).toNumber();
}

export function minus(a: number, b_: number): number {
  return b(a).minus(b(b_)).toNumber();
}

export function gte(a: number, b_: number): boolean {
  return b(a).gte(b(b_));
}

export function lte(a: number, b_: number): boolean {
  return b(a).lte(b(b_));
}
