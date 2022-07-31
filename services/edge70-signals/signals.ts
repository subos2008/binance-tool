/**
 * New highs or lows - pure trend following
 *
 * Probably could be defined as 22d bollenger band breakouts
 *
 * Always long or short - no exit condition added yet
 *
 * */

import Sentry from "../../lib/sentry"
// Sentry.configureScope(function (scope: any) {
//   scope.setTag("service", service_name)
// })

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"
import { Edge60Parameters } from "../../events/shared/edge60-position-entry"
import { CandleChartResult } from "binance-api-node"
import { EdgeCandle, LongShortEntrySignalsCallbacks } from "./interfaces"
import { LimitedLengthCandlesHistory } from "./limited-length-candles-history"
import { DateTime } from "luxon"

export class Edge60EntrySignals {
  symbol: string
  base_asset: string
  logger: Logger
  market_data: CoinGeckoMarketData

  callbacks: LongShortEntrySignalsCallbacks
  price_history_candles: LimitedLengthCandlesHistory

  constructor({
    logger,
    initial_candles,
    symbol,
    market_data,
    callbacks,
    edge60_parameters,
    base_asset,
  }: {
    logger: Logger
    initial_candles: CandleChartResult[]
    symbol: string
    market_data: CoinGeckoMarketData
    callbacks: LongShortEntrySignalsCallbacks
    edge60_parameters: Edge60Parameters
    base_asset: string
  }) {
    this.symbol = symbol
    this.logger = logger
    this.market_data = market_data
    this.callbacks = callbacks
    this.base_asset = base_asset

    this.price_history_candles = new LimitedLengthCandlesHistory({
      length: edge60_parameters.days_of_price_history,
      initial_candles,
    })

    let last_candle = initial_candles[initial_candles.length - 1]
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
    let base_asset = this.base_asset
    let tags: Object = { symbol, base_asset, edge: "edge60" }
    if (timeframe !== "1d") {
      let msg = `Short timeframe candle on ${this.symbol} closed at ${candle.close}`
      this.logger.info(tags, msg)
      throw new Error(msg)
    }

    // assert.equal(symbol, this.symbol)

    this.logger.debug(tags, { signal: "new_candle", symbol }, `${symbol} ingesting new candle`)

    try {
      let potential_entry_price = new BigNumber(candle["close"])
      let high = new BigNumber(candle["high"])
      let low = new BigNumber(candle["low"])
      let { high: highest_price } = this.price_history_candles.get_highest_value()
      let { low: lowest_price } = this.price_history_candles.get_lowest_value()

      // Debug info
      let debug_string = `${symbol}: H: ${high.toFixed()} vs ${highest_price.toFixed()} L: ${low.toFixed()} vs ${lowest_price.toFixed()}`
      // let high_candles

      let direction: "long" | "short" | undefined = undefined

      if (!this.price_history_candles.full()) {
        this.logger.info(
          tags,
          `${symbol}: insufficient candles of history, currently ${this.price_history_candles.current_number_of_stored_candles()}`
        )
        return // should execute finally block
      }

      // Check for entry signal in both directions and ignore
      if (high.isGreaterThan(highest_price) && low.isLessThan(lowest_price)) {
        let msg = `${symbol} Price entry signal both long and short, skipping...`
        this.logger.warn(tags, msg)
        throw new Error(msg)
      }

      let signal_timestamp_ms = DateTime.now().toMillis() + 1 // avoid the last millisecond of the day... why?

      // check for long entry
      if (high.isGreaterThan(highest_price)) {
        direction = "long"
        tags = { ...tags, direction }
        this.logger.info(
          tags,
          `Price entry signal on ${symbol} ${direction} at ${potential_entry_price.toFixed()}: ${high.toFixed()} greater than ${highest_price.toFixed()}: ${debug_string}`
        )
        this.callbacks.enter_position({
          symbol: this.symbol,
          signal_price: potential_entry_price,
          trigger_price: potential_entry_price,
          direction,
          signal_timestamp_ms,
        })
      }

      // check for short entry
      if (low.isLessThan(lowest_price)) {
        direction = "short"
        tags = { ...tags, direction }
        this.logger.info(
          tags,
          `Price entry signal ${direction} at ${potential_entry_price.toFixed()}: ${low.toFixed()} less than ${lowest_price.toFixed()}: ${debug_string}`
        )
        this.callbacks.enter_position({
          symbol: this.symbol,
          signal_price: potential_entry_price,
          trigger_price: potential_entry_price,
          direction,
          signal_timestamp_ms,
        })
      }

      if (direction === undefined) {
        this.logger.info(tags, `${symbol}: No signal ${debug_string}`)
      }
    } catch (err) {
      this.logger.error(`Exception checking or entering position: ${err}`)
      this.logger.error({ err })
      Sentry.captureException(err)
    } finally {
      // important not to miss this - lest we corrupt the history
      this.price_history_candles.push(candle)
    }
  }
}
