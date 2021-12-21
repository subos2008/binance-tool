import { ExchangeIdentifier } from "./exchange-identifier"
import { MarketIdentifier_V2 } from "./market-identifier"

export type PositionChangeEvents =
  | PositionEntryExecutionLog
  | PositionExitExecutionLog
  | PositionIncreaseExecutionLog

export interface PositionEntryExecutionLog {
  version: "v1"
  event_type: "PositionEntryExecutionLog"
  market_identifier: MarketIdentifier_V2
  direction: "long" | "short"
  entry_price: string
  entry_candle_close_timestamp_ms: number
  stop_price: string
  order_executed: { base_amount: string; quote_amount: string }
}
export interface PositionIncreaseExecutionLog {
  version: "v1"
  event_type: "PositionIncreaseExecutionLog"
  market_identifier: MarketIdentifier_V2
  direction: "long" | "short"
  entry_price: string
  entry_candle_close_timestamp_ms: number
  stop_price: string
  order_executed: { base_amount: string; quote_amount: string }
}

export interface PositionExitExecutionLog {
  version: "v1"
  event_type: "PositionExitExecutionLog"
  market_identifier: MarketIdentifier_V2
  signal: "stopped_out"
  direction: "long" | "short"
  exit_price: string
  position_size: string
  exit_candle_close_timestamp_ms: number
}
