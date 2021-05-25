/* New highs from the start of a bull market. Daily close vs highest daily close so far */

// TODO: after 10 days 1f still holding a position say if it's above or below entry price, tag edge56/trend-following/donchen-exits
//        - in cli/positions
//        - in position-tracker
// TODO: store entries made from here in redis so this service can restart, tag edge56/trendfollowing/donchen-exits
// TOOD: signal when open positions go under/over MA200 or MA50, whichever is available
// TODO: add coing-gekko as an exchange and the cli ability to add/adjust/set manual positions
// TOO:how can we run processing to exits - to free up capital before we run processing of new entries? Do potential new entries get stored instead of entered? Maybe entries go on a list for manual response
// TODO: add to position if we are >~30% up since entry price (daily close)
// TODO: stop out at 25% drawdown - presumably that's with just the initial position?
// TODO: we probably want some kind of limit so we don't buy the top of a 2x spike? Or given small position size maybe we are up for that.
// TODO: exit strat - we can do exit in a separate service if we tag positions with the edge in redis
// TODO: don't enter if we already have a position in this symbol
// TODO: check volume is higher than last 7 days volume for entry trigger

import { assert, time } from "console"

import { Binance, Candle, CandleChartInterval, CandleChartResult } from "binance-api-node"
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { CandleUtils, LimitedLengthCandlesHistory } from "../../classes/utils/candle_utils"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"
import { convertToObject } from "typescript"

const humanNumber = require("human-number")

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
    ee,
    logger,
    initial_candles,
    symbol,
    // historical_candle_key,
    // current_candle_key,
    market_data,
    callbacks,
  }: {
    ee: any
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
    this.historical_candle_key = "high"
    this.current_candle_key = "close"
    this.price_history_candles = new LimitedLengthCandlesHistory({
      length: 20,
      initial_candles,
      key: this.historical_candle_key,
    })
    this.volume_history_candles = new LimitedLengthCandlesHistory({ length: 7, initial_candles, key: "volume" })
  }

  ingest_intercandle_close_update_candle(foo: any) {
    return
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

      if (potential_entry_price.isGreaterThan(this.price_history_candles.get_highest_value())) {
        console.log(`Price entry signal at ${potential_entry_price.toFixed()}, ${new Date(candle.closeTime)}`)
        if (potential_entry_volume.isGreaterThan(this.volume_history_candles.get_highest_value())) {
          console.log(`Volume entry signal at ${potential_entry_price.toFixed()}, ${new Date(candle.closeTime)}`)

          this.callbacks.enter_position({
            symbol: this.symbol,
            entry_price: potential_entry_price,
            direction: "long",
          })
        }
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
