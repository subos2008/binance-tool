import { MarketIdentifier_V3 } from "./market-identifier"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

export type Edge60Parameters = {
  days_of_price_history: 22 // didn't feel like just saying number '\o/`
}

export interface Edge60PositionEntrySignal {
  version: "v1"
  edge: "edge60"
  object_type: "Edge60EntrySignal"
  market_identifier: MarketIdentifier_V3
  edge60_parameters: Edge60Parameters
  edge60_entry_signal: {
    direction: "long" | "short"
    entry_price: string
  }
  extra?: {
    previous_direction?: "long" | "short"
    CoinGeckoMarketData?: CoinGeckoMarketData
  }
}
