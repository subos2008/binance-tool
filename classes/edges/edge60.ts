/**
 * New highs or lows - pure trend following
 *
 * Probably could be defined as 22d bollenger band breakouts
 *
 * Always long or short - no exit condition added yet
 *
 * */

import { strict as assert } from "assert"

import { CandleChartResult } from "binance-api-node"
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"
import { Edge60Parameters } from "../../events/shared/edge60-position-entry"

import * as Sentry from "@sentry/node"
Sentry.init({})
// Sentry.configureScope(function (scope: any) {
//   scope.setTag("service", service_name)
// })

export interface Edge60EntrySignalsCallbacks {
  enter_position({
    symbol,
    entry_price,
    direction,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
  }): void
}

export interface EdgeCandle {
  // The candle interface required by this edge
  close: string
  low: string
  high: string
}

class LimitedLengthCandlesHistory {
  private candles: EdgeCandle[]
  private length: number

  // Patch an array object with overrided push() function
  private limited_length_candle_array(length: number, initial_candles: EdgeCandle[]): EdgeCandle[] {
    var array: EdgeCandle[] = initial_candles.slice(-length)
    array.push = function () {
      if (this.length >= length) {
        this.shift()
      }
      return Array.prototype.push.apply(this, arguments as any) // typscript didn't like this
    }
    return array
  }

  constructor({ length, initial_candles }: { length: number; initial_candles: EdgeCandle[] }) {
    this.candles = this.limited_length_candle_array(length, initial_candles)
    this.length = length
  }

  full(): boolean {
    return this.candles.length >= this.length
  }

  current_number_of_stored_candles(): number {
    return this.candles.length
  }

  push(candle: EdgeCandle) {
    this.candles.push(candle)
    assert(this.candles.length <= this.length)
  }

  get_highest_value(): { high: BigNumber; candle: EdgeCandle } {
    function candle_high_value(candle: EdgeCandle) {
      return new BigNumber(candle["high"])
    }
    let high = candle_high_value(this.candles[0])
    let high_candle = this.candles[0]
    for (let i = 0; i < this.candles.length; i++) {
      let candle = this.candles[i]
      let candle_high_price = candle_high_value(candle)
      if (candle_high_price.isGreaterThan(high)) {
        high = candle_high_price
        high_candle = candle
      }
    }
    return { high, candle: high_candle }
  }

  get_lowest_value(): { low: BigNumber; candle: EdgeCandle } {
    function candle_low_value(candle: EdgeCandle) {
      return new BigNumber(candle["low"])
    }
    let low = candle_low_value(this.candles[0])
    let low_candle = this.candles[0]
    for (let i = 0; i < this.candles.length; i++) {
      let candle = this.candles[i]
      let candle_low_price = candle_low_value(candle)
      if (candle_low_price.isLessThan(low)) {
        low = candle_low_price
        low_candle = candle
      }
    }
    return { low, candle: low_candle }
  }
}

export class Edge60EntrySignals {
  symbol: string
  logger: Logger
  market_data: CoinGeckoMarketData

  callbacks: Edge60EntrySignalsCallbacks
  price_history_candles: LimitedLengthCandlesHistory

  constructor({
    logger,
    initial_candles,
    symbol,
    market_data,
    callbacks,
    edge60_parameters,
  }: {
    logger: Logger
    initial_candles: CandleChartResult[]
    symbol: string
    market_data: CoinGeckoMarketData
    callbacks: Edge60EntrySignalsCallbacks
    edge60_parameters: Edge60Parameters
  }) {
    this.symbol = symbol
    this.logger = logger
    this.market_data = market_data
    this.callbacks = callbacks

    this.price_history_candles = new LimitedLengthCandlesHistory({
      length: edge60_parameters.days_of_price_history,
      initial_candles,
    })

    let last_candle = initial_candles[initial_candles.length - 1]
    this.logger.info(`${symbol} last candle: ${JSON.stringify(last_candle)}`)
    if (last_candle.closeTime > Date.now()) throw new Error(`${symbol} partial final candle in initial_candles`)
  }

  static required_initial_candles(edge60_parameters: Edge60Parameters) {
    return Math.max(edge60_parameters.days_of_price_history)
  }

  async ingest_new_candle({
    timeframe,
    candle,
    symbol,
  }: {
    timeframe: string
    symbol: string
    candle: EdgeCandle
  }) {
    if (timeframe !== "1d") {
      console.log(`Short timeframe candle on ${this.symbol} closed at ${candle.close}`)
      throw `Got a short timeframe candle`
    }

    this.logger.debug({ signal: "new_candle", symbol }, `${symbol} ingesting new candle`)

    try {
      let potential_entry_price = new BigNumber(candle["close"])
      let high = new BigNumber(candle["high"])
      let low = new BigNumber(candle["low"])
      let { high: highest_price } = this.price_history_candles.get_highest_value()
      let { low: lowest_price } = this.price_history_candles.get_lowest_value()

      let direction: "long" | "short" | undefined = undefined

      if (!this.price_history_candles.full()) {
        this.logger.info(
          `${symbol}: insufficient candles of history, currently ${this.price_history_candles.current_number_of_stored_candles()}`
        )
        return // should execute finally block
      }

      // Check for entry signal in both directions and ignore
      if (high.isGreaterThan(highest_price) && low.isLessThan(lowest_price)) {
        let msg = `${symbol} Price entry signal both long and short, skipping...`
        this.logger.warn(msg)
        throw new Error(msg)
      }

      // check for long entry
      if (high.isGreaterThan(highest_price)) {
        direction = "long"
        this.logger.info(
          `Price entry signal on ${symbol} ${direction} at ${potential_entry_price.toFixed()}: ${high.toFixed()} greater than ${highest_price.toFixed()}`
        )
        this.callbacks.enter_position({
          symbol: this.symbol,
          entry_price: potential_entry_price,
          direction,
        })
      }

      // check for short entry
      if (low.isLessThan(lowest_price)) {
        direction = "short"
        this.logger.info(
          `Price entry signal ${direction} at ${potential_entry_price.toFixed()}: ${low.toFixed()} less than ${lowest_price.toFixed()}`
        )
        this.callbacks.enter_position({
          symbol: this.symbol,
          entry_price: potential_entry_price,
          direction,
        })
      }

      if (direction === undefined) {
        this.logger.info(
          `${symbol}: No signal H: ${high.toFixed()} vs ${highest_price.toFixed()} L: ${low.toFixed()} vs ${lowest_price.toFixed()}`
        )
      }
    } catch (e) {
      this.logger.error(`Exception checking or entering position: ${e}`)
      console.error(e)
      Sentry.captureException(e)
    } finally {
      // important not to miss this - lest we corrupt the history
      this.price_history_candles.push(candle)
    }
  }
}
