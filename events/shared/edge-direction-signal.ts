import { AuthorisedEdgeType } from "../../classes/spot/abstractions/position-identifier"
import { MarketIdentifier_V3 } from "./market-identifier"

/** For edges that signal flip-flop long/short */
export interface EdgeDirectionSignal {
  object_type: "EdgeDirectionSignal"
  version: "v1"
  edge: AuthorisedEdgeType
  direction: "long" | "short"
  base_asset?: string
  quote_asset?: string
  symbol: string
  exchange_type: "spot" | "margin"
  signal_timestamp_ms: string

  market_identifier: MarketIdentifier_V3
}
