import { ExchangeIdentifier } from "./exchange-identifier"
import { MarketIdentifier_V2 } from "./market-identifier"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

export type Edge56Parameters = {
  days_of_price_history: 20 // didn't feel like just saying number '\o/`
  long_highest_volume_in_days: 7 //
  // historical_candle_key:  "close" // this can't be high since we switched to trading in both directions
  // current_candle_key:  "close"
}

export interface Edge56PositionEntrySignal {
  version: "v1"
  event_type: "Edge56EntrySignal"
  market_identifier: MarketIdentifier_V2
  edge56_parameters: Edge56Parameters
  edge56_entry_signal: {
    direction: "long" | "short"
    entry_price: string
  }
  extra?: {
    CoinGeckoMarketData?: CoinGeckoMarketData
  }
}
