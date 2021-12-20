import { ExchangeIdentifier } from "./exchange-identifier"
import { MarketIdentifier_V2 } from "./market-identifier"

export type PositionChangeEvents = PositionEntryExecutionLog | PositionExitExecutionLog

export interface PositionEntryExecutionLog {
  version: "v1"
  event_type: "PositionEntryExecutionLog"
  market_identifier: MarketIdentifier_V2
  direction: "long" | "short"
  entry_price: string
}

export interface PositionExitExecutionLog {
  version: "v1"
  event_type: "PositionExitExecutionLog"
  market_identifier: MarketIdentifier_V2
  signal: "stopped_out"
  direction: "long" | "short"
  exit_price: string
}