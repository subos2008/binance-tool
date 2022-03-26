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

import * as Sentry from "@sentry/node"
Sentry.init({})
// Sentry.configureScope(function (scope: any) {
//   scope.setTag("service", service_name)
// })

import { Logger } from "../../interfaces/logger"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"
import { Edge61Parameters } from "../../events/shared/edge61-position-entry"
import { RetriggerPrevention } from "./retrigger-prevention"
import { LongShortEntrySignalsCallbacks, StoredCandle, IngestionCandle, PositionEntryArgs } from "./interfaces"
import { LimitedLengthCandlesHistory } from "./limited-length-candles-history"
import { RedisClientType } from "redis-v4"
import { TriggerMidTrendOnRestartPrevention } from "./trigger-mid-trend-on-restart-prevention"
import { DirectionPersistance } from "./direction-persistance"
import { DateTime } from "luxon"

function dogstatsderrorhandler(error: any) {
  console.log("DogStatsD: Socket errors caught here: ", error)
}
var StatsD = require("hot-shots")
var dogstatsd = new StatsD({ errorHandler: dogstatsderrorhandler })
export class Edge61EntrySignals {
  symbol: string
  logger: Logger
  market_data: CoinGeckoMarketData

  callbacks: LongShortEntrySignalsCallbacks
  price_history_candles: LimitedLengthCandlesHistory
  retrigger_prevention: RetriggerPrevention
  trigger_on_restart_prevention: TriggerMidTrendOnRestartPrevention
  direction_persistance: DirectionPersistance

  constructor({
    logger,
    initial_candles,
    symbol,
    market_data,
    callbacks,
    edge61_parameters,
    redis,
    direction_persistance,
  }: {
    logger: Logger
    initial_candles: CandleChartResult[]
    symbol: string
    market_data: CoinGeckoMarketData
    callbacks: LongShortEntrySignalsCallbacks
    edge61_parameters: Edge61Parameters
    redis: RedisClientType
    direction_persistance: DirectionPersistance
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
    this.direction_persistance = direction_persistance
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
    try {
      dogstatsd.increment(`trading-engine.edge-signals.candle-ingested`, 1, 1, { edge: "edge61", symbol })
    } catch (e) {
      this.logger.warn(`Failed to submit metrics to DogStatsD`)
      Sentry.captureException(e)
    }

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

      let signal_timestamp_ms = DateTime.now().toMillis() + 1 // avoid the last millisecond of the day

      // check for long entry
      if (signal_high) {
        direction = "long"
        this.enter_position(
          {
            symbol: this.symbol,
            trigger_price: highest_price, // use the donchen band price instead of the price we noticed the cross at
            signal_price: potential_entry_price, // the price we noticed the cross at (i.e. trigger_price + realisation slippage)
            direction,
            signal_timestamp_ms,
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
            trigger_price: lowest_price, // the donchen band price
            signal_price: potential_entry_price, // the price we noticed the cross at (i.e. trigger_price + realisation slippage)
            direction,
            signal_timestamp_ms,
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
    // let candle_close_time_seconds_in_ms_remainder = entry_candle.closeTime % 1000
    // let candle_close_time_in_seconds = entry_candle.closeTime - candle_close_time_seconds_in_ms_remainder
    // let candle_close_time_seconds = candle_close_time_in_seconds / 1000
    // let candle_close_time_seconds_modulo_remainder_24h = candle_close_time_seconds % 86400
    // let candle_open_time = candle_close_time_seconds - candle_close_time_seconds_modulo_remainder_24h
    // let one_day_in_seconds = 60 * 60 * 24
    // let expiry_timestamp_seconds = candle_open_time + one_day_in_seconds

    var end = new Date(args.signal_timestamp_ms)
    end.setUTCHours(23, 59, 59, 999)
    let expiry_timestamp = end.getTime()

    let signal_allowed = await this.retrigger_prevention.atomic_trigger_check_and_prevent(args, expiry_timestamp)

    /** Guard on trend reversal - actually no we took this out as a guard */
    // we just maintain this in case we decide to use it later
    let previous_direction = await this.direction_persistance.set_direction(args.symbol, args.direction)
    // if (previous_direction === null) {
    //   this.logger.info(
    //     `possible ${args.direction} entry signal on ${args.symbol} - check manually if this is a trend reversal.`
    //   )
    //   return
    // }
    // let direction_change = previous_direction && previous_direction != args.direction
    // signal_allowed = signal_allowed && direction_change

    if (signal_allowed) {
      this.logger.info(
        `Price entry signal on ${args.symbol} ${
          args.direction
        } at trigger: ${args.trigger_price.toFixed()}, signal: ${args.signal_price.toFixed()}`
      )
      this.logger.info(
        args,
        `Set expiry for additional entries into ${args.symbol} to ${expiry_timestamp}, IngestionCandle closeTime ${entry_candle.closeTime}`
      )
      this.callbacks.enter_position(args)
    }
  }
}
