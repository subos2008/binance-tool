/* New highs from the start of a bull market. Daily close vs highest daily close so far */

// TODO: after 10 days 1f still holding a position say if it's above or below entry price, tag edge56/trend-following/donchen-exits
//        - in cli/positions
//        - in position-tracker
// TODO: store entries made from here in redis so this service can restart, tag edge56/trendfollowing/donchen-exits
// TOOD: signal when open positions go under/over MA200 or MA50, whichever is available
// TODO: add coin-gekko as an exchange and the cli ability to add/adjust/set manual positions
// TODO: add to position if we are >~30% up since entry price (daily close)

// TODO: Entry
// 1. Add MACD

// TODO: Exits
// 1. Stop loss: 25% or 10% from entry
// 2. time based: if it's not up after 10 days cut it
// 3. Chandelier
// 4. edge short entry signal
// 5. Peter Brandt style exit: high candle, setup candle, exit: https://www.youtube.com/watch?v=kxjYGO-N1VA at 9-12 minutes

// TODO: Increase Position Size
// 1. Breakout of Donchien channel (new high after a range period). The question is does a day of down followed the next day by a Donchien channel breakout count..

import { Candle, CandleChartResult } from "binance-api-node"
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { LimitedLengthCandlesHistory } from "../../classes/utils/candle_utils"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

export interface Edge56EntrySignalsCallbacks {
  enter_position({
    symbol,
    entry_price,
    direction,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
  }): void
  in_position(symbol: string): boolean
}

export class Edge56EntrySignals {
  symbol: string
  logger: Logger
  market_data: CoinGeckoMarketData

  historical_candle_key: "high" | "close"
  current_candle_key: "high" | "close"

  callbacks: Edge56EntrySignalsCallbacks
  price_history_candles: LimitedLengthCandlesHistory
  volume_history_candles: LimitedLengthCandlesHistory

  constructor({
    logger,
    initial_candles,
    symbol,
    // historical_candle_key,
    // current_candle_key,
    market_data,
    callbacks,
  }: {
    logger: Logger
    initial_candles: CandleChartResult[]
    symbol: string
    // historical_candle_key: "high" | "close"
    // current_candle_key: "high" | "close"
    market_data: CoinGeckoMarketData
    callbacks: Edge56EntrySignalsCallbacks
  }) {
    this.symbol = symbol
    this.logger = logger
    this.market_data = market_data
    this.callbacks = callbacks

    // Edge config - hardcoded as this should be static to the edge
    this.historical_candle_key = "close"
    this.current_candle_key = "close"
    this.price_history_candles = new LimitedLengthCandlesHistory({
      length: 20,
      initial_candles,
      key: this.historical_candle_key,
    })
    this.volume_history_candles = new LimitedLengthCandlesHistory({ length: 7, initial_candles, key: "volume" })
  }

  async ingest_new_candle({
    timeframe,
    candle,
    symbol,
  }: {
    timeframe: string
    symbol: string
    candle: CandleChartResult | Candle
  }) {
    if (timeframe !== "1d") {
      console.log(`Short timeframe candle on ${this.symbol} closed at ${candle.close}`)
      throw `Got a short timeframe candle`
    }

    try {
      let potential_entry_price = new BigNumber(candle[this.current_candle_key])
      let potential_entry_volume = new BigNumber(candle["volume"])

      if (potential_entry_volume.isGreaterThan(this.volume_history_candles.get_highest_value())) {
        console.log(`Volume entry signal on ${symbol} at ${potential_entry_price.toFixed()}, ${new Date(candle.closeTime)}`)
      } else {
        return // no volume = no entry
      }

      // check for long entry
      if (potential_entry_price.isGreaterThan(this.price_history_candles.get_highest_value())) {
        let direction: "long" = "long"
        console.log(
          `Price entry signal on ${symbol} ${direction} at ${potential_entry_price.toFixed()}, ${new Date(candle.closeTime)}`
        )
        this.callbacks.enter_position({
          symbol: this.symbol,
          entry_price: potential_entry_price,
          direction,
        })
      }

      // check for short entry
      if (potential_entry_price.isLessThan(this.price_history_candles.get_lowest_value())) {
        let direction: "short" = "short"
        console.log(
          `Price entry signal ${direction} at ${potential_entry_price.toFixed()}, ${new Date(candle.closeTime)}`
        )
        this.callbacks.enter_position({
          symbol: this.symbol,
          entry_price: potential_entry_price,
          direction,
        })
      }
    } catch (e) {
      this.logger.error(`Exception checking or entering position: ${e}`)
      console.error(e)
    } finally {
      // important not to miss this - lest we corrupt the history
      this.price_history_candles.push(candle)
      this.volume_history_candles.push(candle)
    }
  }
}
