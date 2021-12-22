import { MarketIdentifier_V2 } from "../../../events/shared/market-identifier"
import { CoinGeckoMarketData } from "../../utils/coin_gecko"
import {ADX_parameters} from '../../indicators/adx'

export type Edge58Parameters_V1 = {
  version: "v1"
  candle_timeframe: "1w"
  candles_of_price_history: 2 // compare the newly closed candle with the previous N weeks
  stops: {
    wick_definitions_percentages_of_body: { // Percentags of wick to body that define each wick size
      'minimal_wick_less_than': "5",
      // 'medium_wick': 
      'large_wick_greater_than': "10"
    }
    stop_percentages: { // stop percentage to use to each wick size
      'minimal_wick': "4", // 3-5% suggested
      'default': "6" // 5-8% suggested
      'large_wick': "12" // 10-15% suggested
    }
  }
  entry_filters:{
    candle_body_percentage_considered_too_large: "35"
    adx_parameters: ADX_parameters
  }
}

export type Edge58Events = Edge58EntrySignal | Edge58ExitSignal
export interface Edge58EntrySignal {
  version: "v1"
  event_type: "Edge58EntrySignal"
  market_identifier: MarketIdentifier_V2
  edge58_parameters: Edge58Parameters_V1
  edge58_entry_signal: {
    direction: "long" | "short"
    entry_price: string
  }
  extra?: {
    CoinGeckoMarketData?: CoinGeckoMarketData
  }
  add_to_position_ok: boolean
  enter_position_ok: boolean
  entry_candle_close_timestamp_ms: number
  stop_price: string
}

export interface Edge58ExitSignal {
  version: "v1"
  event_type: "Edge58ExitSignal"
  market_identifier: MarketIdentifier_V2
  edge58_parameters: Edge58Parameters_V1
  edge58_exit_signal: {
    signal: "stopped_out"
    direction: "long" | "short"
    exit_price: string
  }
  position: {
    position_size: string
  }
  exit_candle_close_timestamp_ms: number
}
