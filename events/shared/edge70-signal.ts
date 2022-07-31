import { MarketIdentifier_V4 } from "./market-identifier"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

// long and short signals based on breakouts with a fixed % stop. long=enter, short=close for spot
// Modification of edge60 where the long and short signals can have different lookback periods

export type Edge70Parameters = {
  // days_of_price_history should be one less than the number we use on the TV high/low indicator
  days_of_price_history_for_long: 44  // one less than the number we use on the TV high/low indicator
  days_of_price_history_for_short: 21 // one less than the number we use on the TV high/low indicator
}

// For storage of event data the configuration and mcap data is included
export interface Edge70Signal {
  version: 1
  edge: "edge70"
  object_type: "Edge70Signal"
  base_asset?: string
  direction: "long" | "short"
  msg: string
  market_identifier: MarketIdentifier_V4
  edge70_parameters: Edge70Parameters
  signal: {
    direction: "long" | "short"
    signal_price: string
    signal_timestamp_ms: number
  }
  extra?: {
    previous_direction?: "long" | "short"
    CoinGeckoMarketData?: CoinGeckoMarketData
  }
}
