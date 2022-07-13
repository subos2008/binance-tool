import { MarketIdentifier_V4 } from "./market-identifier"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

export type Edge61Parameters = {
  days_of_price_history: 22 // didn't feel like just saying number '\o/`
}

export interface Edge61PositionEntrySignal {
  version: "v2"
  edge: "edge61"
  object_type: "Edge61EntrySignal"
  market_identifier: MarketIdentifier_V4
  edge61_parameters: Edge61Parameters
  edge61_entry_signal: {
    direction: "long" | "short"
    entry_price: string // depricated, is trigger_price
    trigger_price: string // price at which the signal should have triggered
    signal_price: string // price at which the signal triggered (slippage vs trigger price)
    signal_timestamp_ms: number
  }
  extra?: {
    CoinGeckoMarketData?: CoinGeckoMarketData
  }
}
