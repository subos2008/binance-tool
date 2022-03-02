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
import { Edge61Parameters } from "../../events/shared/edge61-position-entry"
import { RetriggerPrevention } from "./retrigger-prevention"

import * as Sentry from "@sentry/node"
Sentry.init({})
// Sentry.configureScope(function (scope: any) {
//   scope.setTag("service", service_name)
// })

import { LongShortEntrySignalsCallbacks, StoredCandle, IngestionCandle, PositionEntryArgs } from "./interfaces"
import { LimitedLengthCandlesHistory } from "./limited-length-candles-history"
import { RedisClient } from "redis"
import { TriggerMidTrendOnRestartPrevention } from "./trigger-mid-trend-on-restart-prevention"

export class Edge61EntrySignals {
  symbol: string
  logger: Logger
  market_data: CoinGeckoMarketData

  callbacks: LongShortEntrySignalsCallbacks
  price_history_candles: LimitedLengthCandlesHistory
  retrigger_prevention: RetriggerPrevention
  trigger_on_restart_prevention: TriggerMidTrendOnRestartPrevention

  constructor({
    logger,
    initial_candles,
    symbol,
    market_data,
    callbacks,
    edge61_parameters,
    redis,
  }: {
    logger: Logger
    initial_candles: CandleChartResult[]
    symbol: string
    market_data: CoinGeckoMarketData
    callbacks: LongShortEntrySignalsCallbacks
    edge61_parameters: Edge61Parameters
    redis: RedisClient
  }) {
    this.symbol = symbol
    this.logger = logger
    this.market_data = market_data
    this.callbacks = callbacks

    this.price_history_candles = new LimitedLengthCandlesHistory({
      length: edge61_parameters.days_of_price_history,
      initial_candles,
    })

    let last_candle = initial_candles[initial_candles.length - 1]
    if (last_candle.closeTime > Date.now()) throw new Error(`${symbol} partial final candle in initial_candles`)

    this.trigger_on_restart_prevention = new TriggerMidTrendOnRestartPrevention()
    this.retrigger_prevention = new RetriggerPrevention({
      redis,
      key_prefix: `edge61:retrigger-prevention:binance:spot`,
    })
  }

  static required_initial_candles(edge61_parameters: Edge61Parameters) {
    return Math.max(edge61_parameters.days_of_price_history)
  }

  async ingest_new_candle({
    timeframe,
    candle,
    symbol,
  }: {
    timeframe: string
    symbol: string
    candle: IngestionCandle
  }) {
    if (candle.isFinal) {
      this.trigger_on_restart_prevention.process_new_daily_close_candle()
    }

    if (timeframe !== "1d") {
      let msg = `Short timeframe candle on ${this.symbol} closed at ${candle.close}`
      this.logger.info(msg)
      throw new Error(msg)
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
        this.logger.debug(
          `${symbol}: insufficient candles of history, currently ${this.price_history_candles.current_number_of_stored_candles()}`
        )
        return // should execute finally block
      }

      let signal_high = high.isGreaterThan(highest_price)
      let signal_low = low.isLessThan(lowest_price)

      this.trigger_on_restart_prevention.process_symbol({ symbol, signal_high, signal_low })
      if (!this.trigger_on_restart_prevention.signal_allowed_on_symbol(symbol)) {
        return
      }

      // Check for entry signal in both directions and ignore
      if (signal_high && signal_low) {
        let msg = `${symbol} Price entry signal both long and short, skipping...`
        this.logger.warn(msg)
        throw new Error(msg)
      }

      // check for long entry
      if (signal_high) {
        direction = "long"
        this.enter_position(
          {
            symbol: this.symbol,
            entry_price: potential_entry_price,
            direction,
          },
          candle
        )
      }

      // check for short entry
      if (signal_low) {
        direction = "short"
        this.enter_position(
          {
            symbol: this.symbol,
            entry_price: potential_entry_price,
            direction,
          },
          candle
        )
      }

      if (direction === undefined) {
        this.logger.debug(
          `${symbol}: No signal H: ${high.toFixed()} vs ${highest_price.toFixed()} L: ${low.toFixed()} vs ${lowest_price.toFixed()}`
        )
      }
    } catch (e) {
      this.logger.error(`Exception checking or entering position: ${e}`)
      this.logger.error(e)
      Sentry.captureException(e)
    } finally {
      // important not to miss this - lest we corrupt the history
      if (candle.isFinal) {
        this.price_history_candles.push(candle)
      }
    }
  }

  async enter_position(args: PositionEntryArgs, entry_candle: IngestionCandle): Promise<void> {
    /**
     * if we trigger then we prevent triggering again until the next close candle
     */

    // closeTime of the passed in entry_candle is the current time - for partial candles in ms
    // so first let's get the start time in seconds of the current daily candle

    // So closeTime is any given millisecond mid-day, or porentially an end of day close candle
    let candle_close_time_seconds_in_ms_remainder = entry_candle.closeTime % 1000
    let candle_close_time_in_seconds = entry_candle.closeTime - candle_close_time_seconds_in_ms_remainder
    let candle_close_time_seconds = candle_close_time_in_seconds / 1000
    let candle_close_time_seconds_modulo_remainder_24h = candle_close_time_seconds % 86400
    let candle_open_time = candle_close_time_seconds - candle_close_time_seconds_modulo_remainder_24h
    let one_day_in_seconds = 60 * 60 * 24
    let expiry_timestamp_seconds = candle_open_time + one_day_in_seconds
    let signal_allowed = await this.retrigger_prevention.atomic_trigger_check_and_prevent(
      args,
      expiry_timestamp_seconds
    )

    if (signal_allowed) {
      this.logger.info(`Price entry signal on ${args.symbol} ${args.direction} at ${args.entry_price.toFixed()}`)
      this.logger.info(
        args,
        `Set expiry for additional entries into ${args.symbol} to ${expiry_timestamp_seconds}, IngestionCandle closeTime ${entry_candle.closeTime}`
      )
      this.callbacks.enter_position(args)
    }
  }
}
