import { ExchangeIdentifier } from "./exchange-identifier"
import { MarketIdentifier_V2 } from "./market-identifier"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

export type Edge58Parameters = {
  candle_timeframe: "1w"
  candles_of_price_history: 2 // compare the newly closed candle with the previous N weeks
}

export interface Edge58PositionEntrySignal {
  version: "v1"
  event_type: "Edge58EntrySignal"
  market_identifier: MarketIdentifier_V2
  edge58_parameters: Edge58Parameters
  edge58_entry_signal: {
    direction: "long" | "short"
    entry_price: string
  }
  extra?: {
    CoinGeckoMarketData?: CoinGeckoMarketData
  }
}
