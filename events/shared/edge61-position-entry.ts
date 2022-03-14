import { MarketIdentifier_V3 } from "./market-identifier"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

export type Edge61Parameters = {
  days_of_price_history: 22 // didn't feel like just saying number '\o/`
}

export interface Edge61PositionEntrySignal {
  version: "v1"
  edge: "edge61"
  object_type: "Edge61EntrySignal"
  market_identifier: MarketIdentifier_V3
  edge61_parameters: Edge61Parameters
  edge61_entry_signal: {
    direction: "long" | "short"
    entry_price: string // depricated, is trigger_price
    trigger_price: string // price at which the signla should have triggered
    signal_price: string // price at which the signal triggered (slippage vs trigger price)
  }
  extra?: {
    CoinGeckoMarketData?: CoinGeckoMarketData
  }
}
