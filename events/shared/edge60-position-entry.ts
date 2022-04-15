import { MarketIdentifier_V3 } from "./market-identifier"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

export type Edge60Parameters = {
  days_of_price_history: 22 // didn't feel like just saying number '\o/`
}

export interface Edge60PositionEntrySignal {
  version: "v1" | 2
  edge: "edge60"
  object_type: "Edge60EntrySignal"
  market_identifier: MarketIdentifier_V3
  edge60_parameters: Edge60Parameters
  edge60_entry_signal: {
    direction: "long" | "short"
    signal_price: string
    signal_timestamp_ms: number
  }
  extra?: {
    previous_direction?: "long" | "short"
    CoinGeckoMarketData?: CoinGeckoMarketData
  }
}
