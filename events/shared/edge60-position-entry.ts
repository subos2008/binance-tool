import { MarketIdentifier_V4 } from "./market-identifier"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

// long and short signals based on breakouts with a fixed % stop. long=enter, short=close for spot
// Note this edge does not perform well short, use edge62 instead

export type Edge60Parameters = {
  // days_of_price_history should be one less than the number we use on the TV high/low indicator
  days_of_price_history: 21 // didn't feel like just saying number '\o/`
}

export interface Edge60PositionEntrySignal {
  version: "v1" | 2
  edge: "edge60"
  object_type: "Edge60EntrySignal"
  base_asset?: string
  direction: "long" | "short"
  msg: string
  market_identifier: MarketIdentifier_V4
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
