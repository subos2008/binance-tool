import { MarketIdentifier_V5, MarketIdentifier_V5_with_base_asset } from "../../../events/shared/market-identifier"
import { CoinGeckoMarketData } from "../../../classes/utils/coin_gecko"

// long and short signals based on breakouts with a fixed % stop. long=enter, short=close for spot
// Modification of edge60 where the long and short signals can have different lookback periods

export type Edge70Parameters = {
  // days_of_price_history should be one less than the number we use on the TV high/low indicator
  candle_timeframe: "1d"
  candles_of_price_history: {
    long: 44 // one less than the number we use on the TV high/low indicator
    short: 21 // one less than the number we use on the TV high/low indicator
  }
}

export type Edge70BacktestParameters = {
  // days_of_price_history should be one less than the number we use on the TV high/low indicator
  candle_timeframe: "1d"
  candles_of_price_history: {
    long: 44 // one less than the number we use on the TV high/low indicator
    short: 21 // one less than the number we use on the TV high/low indicator
  }
  stop_factor: string
  starting_cash: string | number
  symbols_to_run: number
}

// For storage of event data the configuration and mcap data is included
export interface Edge70Signal {
  version: 1
  edge: "edge70" | "edge70-backtest"
  object_type: "Edge70Signal"
  base_asset?: string
  direction: "long" | "short"
  msg: string
  test_signal: boolean // set when signal is a system test instead of a real signal
  market_identifier: MarketIdentifier_V5_with_base_asset
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
