/**
 * Position Manager - Position tracking with TP/SL
 */

import { randomUUID } from "node:crypto";
import {
  entryReturnPercent,
  gte,
  lte,
  minus,
  pnl,
  plus,
  sumDecimals,
  winRatePercent,
} from "./big_calc.js";

export type ExitType = "take_profit" | "stop_loss" | null;

export class Position {
  id: string;
  side: string;
  token_id: string;
  entry_price: number;
  size: number;
  entry_time: number;
  order_id: string | null;
  take_profit_delta: number;
  stop_loss_delta: number;

  constructor(
    id: string,
    side: string,
    token_id: string,
    entry_price: number,
    size: number,
    entry_time: number,
    order_id: string | null = null,
    take_profit_delta = 0.1,
    stop_loss_delta = 0.05
  ) {
    this.id = id;
    this.side = side;
    this.token_id = token_id;
    this.entry_price = entry_price;
    this.size = size;
    this.entry_time = entry_time;
    this.order_id = order_id;
    this.take_profit_delta = take_profit_delta;
    this.stop_loss_delta = stop_loss_delta;
  }

  get take_profit_price(): number {
    return plus(this.entry_price, this.take_profit_delta);
  }

  get stop_loss_price(): number {
    return minus(this.entry_price, this.stop_loss_delta);
  }

  getPnl(current_price: number): number {
    return pnl(this.entry_price, current_price, this.size);
  }

  getPnlPercent(current_price: number): number {
    return entryReturnPercent(this.entry_price, current_price);
  }

  getHoldTime(): number {
    return Date.now() / 1000 - this.entry_time;
  }

  checkTakeProfit(current_price: number): boolean {
    return gte(current_price, this.take_profit_price);
  }

  checkStopLoss(current_price: number): boolean {
    return lte(current_price, this.stop_loss_price);
  }
}

export class PositionManager {
  take_profit = 0.1;
  stop_loss = 0.05;
  max_positions = 1;

  private _positions: Map<string, Position> = new Map();
  private _positions_by_side: Map<string, string> = new Map();

  trades_opened = 0;
  trades_closed = 0;
  total_pnl = 0;
  winning_trades = 0;
  losing_trades = 0;

  get positionCount(): number {
    return this._positions.size;
  }

  get canOpenPosition(): boolean {
    return this.positionCount < this.max_positions;
  }

  get winRate(): number {
    return winRatePercent(this.winning_trades, this.losing_trades);
  }

  openPosition(
    side: string,
    token_id: string,
    entry_price: number,
    size: number,
    order_id: string | null = null
  ): Position | null {
    if (!this.canOpenPosition) return null;
    if (this._positions_by_side.has(side)) return null;

    const posId = randomUUID().slice(0, 8);
    const position = new Position(
      posId,
      side,
      token_id,
      entry_price,
      size,
      Date.now() / 1000,
      order_id,
      this.take_profit,
      this.stop_loss
    );
    this._positions.set(posId, position);
    this._positions_by_side.set(side, posId);
    this.trades_opened += 1;
    return position;
  }

  closePosition(position_id: string, realized_pnl = 0): Position | null {
    const position = this._positions.get(position_id);
    if (!position) return null;
    this._positions.delete(position_id);
    if (this._positions_by_side.get(position.side) === position_id) {
      this._positions_by_side.delete(position.side);
    }
    this.trades_closed += 1;
    this.total_pnl += realized_pnl;
    if (realized_pnl >= 0) this.winning_trades += 1;
    else this.losing_trades += 1;
    return position;
  }

  getPosition(position_id: string): Position | undefined {
    return this._positions.get(position_id);
  }

  getPositionBySide(side: string): Position | undefined {
    const id = this._positions_by_side.get(side);
    if (!id) return undefined;
    return this._positions.get(id);
  }

  getAllPositions(): Position[] {
    return [...this._positions.values()];
  }

  hasPosition(side: string): boolean {
    return this._positions_by_side.has(side);
  }

  checkExit(position_id: string, current_price: number): [ExitType, number] {
    const position = this._positions.get(position_id);
    if (!position) return [null, 0];
    const pnl = position.getPnl(current_price);
    if (position.checkTakeProfit(current_price)) return ["take_profit", pnl];
    if (position.checkStopLoss(current_price)) return ["stop_loss", pnl];
    return [null, pnl];
  }

  checkAllExits(prices: Record<string, number>): Array<[Position, ExitType, number]> {
    const exits: Array<[Position, ExitType, number]> = [];
    for (const position of this._positions.values()) {
      const price = prices[position.side] ?? 0;
      if (price <= 0) continue;
      const [exitType, pnl] = this.checkExit(position.id, price);
      if (exitType) exits.push([position, exitType, pnl]);
    }
    return exits;
  }

  getUnrealizedPnl(prices: Record<string, number>): number {
    const parts: number[] = [];
    for (const position of this._positions.values()) {
      const price = prices[position.side] ?? 0;
      if (price > 0) parts.push(position.getPnl(price));
    }
    return sumDecimals(parts);
  }

  getTotalPnl(prices: Record<string, number>): number {
    return this.total_pnl + this.getUnrealizedPnl(prices);
  }

  getStats(): Record<string, number> {
    return {
      trades_opened: this.trades_opened,
      trades_closed: this.trades_closed,
      open_positions: this.positionCount,
      total_pnl: this.total_pnl,
      winning_trades: this.winning_trades,
      losing_trades: this.losing_trades,
      win_rate: this.winRate,
    };
  }

  clear(): void {
    this._positions.clear();
    this._positions_by_side.clear();
  }

  resetStats(): void {
    this.trades_opened = 0;
    this.trades_closed = 0;
    this.total_pnl = 0;
    this.winning_trades = 0;
    this.losing_trades = 0;
  }
}
