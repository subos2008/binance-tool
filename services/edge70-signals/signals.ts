/**
 * New highs or lows - pure trend following
 *
 * Probably could be defined as Donchien channel band breakouts
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

import { ServiceLogger } from "../../interfaces/logger"
import { CandleChartResult } from "binance-api-node"
import { Edge70SignalCallbacks, EdgeCandle } from "./interfaces/_internal"
import { LimitedLengthCandlesHistory } from "./limited-length-candles-history"
import { DateTime } from "luxon"
import { Edge70Parameters, Edge70Signal } from "./interfaces/edge70-signal"
import { Tags } from "../../observability/loggable-tags"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { MarketIdentifier_V5_with_base_asset } from "../../events/shared/market-identifier"
import { SendMessageFunc } from "../../interfaces/send-message"
import { Direction, DirectionPersistence } from "./interfaces/direction-persistance"

/* Instantiated per asset; each exchange symbol has its own instance of this class */
export class Edge70Signals {
  logger: ServiceLogger
  set_log_time_to_candle_time: boolean = false

  send_message: SendMessageFunc
  health_and_readiness: HealthAndReadinessSubsystem
  edge: "edge70" | "edge70-backtest" = "edge70"
  edge70_parameters: Edge70Parameters
  market_identifier: MarketIdentifier_V5_with_base_asset
  direction_persistance: DirectionPersistence

  callbacks: Edge70SignalCallbacks
  price_history_candles_long: LimitedLengthCandlesHistory
  price_history_candles_short: LimitedLengthCandlesHistory

  constructor({
    logger,
    send_message,
    health_and_readiness,
    initial_candles,
    market_identifier,
    callbacks,
    edge70_parameters,
    edge,
    direction_persistance,
    set_log_time_to_candle_time, // used when backtesting
  }: {
    logger: ServiceLogger
    set_log_time_to_candle_time?: boolean
    send_message: SendMessageFunc
    health_and_readiness: HealthAndReadiness
    initial_candles: CandleChartResult[]
    market_identifier: MarketIdentifier_V5_with_base_asset
    callbacks: Edge70SignalCallbacks
    edge70_parameters: Edge70Parameters
    edge?: "edge70-backtest"
    direction_persistance: DirectionPersistence
  }) {
    this.logger = logger
    this.market_identifier = market_identifier
    if (set_log_time_to_candle_time) this.set_log_time_to_candle_time = set_log_time_to_candle_time
    this.send_message = send_message
    this.callbacks = callbacks
    this.edge70_parameters = edge70_parameters
    this.direction_persistance = direction_persistance
    if (edge) this.edge = edge
    this.health_and_readiness = health_and_readiness.addSubsystem({
      name: `Edge70Signals-${market_identifier.symbol}`,
      ready: true,
      healthy: true,
    })

    this.price_history_candles_long = new LimitedLengthCandlesHistory({
      length: edge70_parameters.candles_of_price_history.long,
      initial_candles,
    })

    this.price_history_candles_short = new LimitedLengthCandlesHistory({
      length: edge70_parameters.candles_of_price_history.short,
      initial_candles,
    })

    let last_candle = initial_candles[initial_candles.length - 1]
    if (last_candle && last_candle.closeTime > Date.now())
      throw new Error(`${this.market_identifier.symbol} partial final candle in initial_candles`)
  }

  /* number of candles of history we need for the edge to be properly initialised */
  static required_initial_candles(edge70_parameters: Edge70Parameters) {
    return Math.max(
      edge70_parameters.candles_of_price_history.long,
      edge70_parameters.candles_of_price_history.short
    )
  }

  async current_market_direction(): Promise<Direction | null> {
    return this.direction_persistance.get_direction(this.market_identifier.base_asset)
  }

  full(): boolean {
    return this.price_history_candles_long.full() && this.price_history_candles_short.full()
  }

  private check_for_long_signal({
    candle,
    price_history_candles,
    tags,
  }: {
    candle: EdgeCandle
    price_history_candles: LimitedLengthCandlesHistory
    tags: Tags
  }): { tags: Tags; signal_long: boolean; debug_string_long: string } {
    let signal_long: boolean | undefined = undefined
    let debug_string_long: string | undefined
    const current = price_history_candles.current_number_of_stored_candles()
    const required = price_history_candles.required_number_of_stored_candles()

    if (!price_history_candles.full()) {
      signal_long = false
      debug_string_long = `Insufficient candles of history ${current}/${required}`
    } else {
      // check for long entry
      const high = new BigNumber(candle["high"])
      let { high: highest_price } = price_history_candles.get_highest_value()
      signal_long = high.isGreaterThan(highest_price) // note we include wicks
      debug_string_long = `H: ${high.toFixed()} vs ${highest_price.toFixed()}(${current})`
    }

    tags = { ...tags, signal_long }
    return { tags, signal_long, debug_string_long }
  }

  private check_for_short_signal({
    candle,
    price_history_candles,
    tags,
  }: {
    candle: EdgeCandle
    price_history_candles: LimitedLengthCandlesHistory
    tags: Tags
  }): { tags: Tags; signal_short: boolean; debug_string_short: string } {
    let signal_short: boolean | undefined = undefined
    let debug_string_short: string | undefined
    const current = price_history_candles.current_number_of_stored_candles()
    const required = price_history_candles.required_number_of_stored_candles()

    if (!price_history_candles.full()) {
      signal_short = false
      debug_string_short = `Insufficient candles of history ${current}/${required}`
    } else {
      // check for short entry
      let low = new BigNumber(candle["low"])
      let { low: lowest_price } = price_history_candles.get_lowest_value()
      signal_short = low.isLessThan(lowest_price) // note we include wicks
      debug_string_short = `L: ${low.toFixed()} vs ${lowest_price.toFixed()}(${current})`
    }

    tags = { ...tags, signal_short }
    return { tags, signal_short, debug_string_short }
  }

  async ingest_new_candle({ candle, symbol }: { symbol: string; candle: EdgeCandle }): Promise<void> {
    let { edge } = this
    let { base_asset } = this.market_identifier
    let tags: Tags = { symbol, base_asset, edge }
    if (this.set_log_time_to_candle_time) tags.time = new Date(candle.closeTime).toISOString()

    try {
      /* start code with finally block */

      // let signal_timestamp_ms = DateTime.now().toMillis() + 1 // avoid the last millisecond of the day... why?
      let signal_timestamp_ms = DateTime.fromMillis(candle.closeTime).toMillis() + 1 // avoid the last millisecond of the day... why?

      // check for long entry
      let long_result = this.check_for_long_signal({
        candle,
        price_history_candles: this.price_history_candles_long,
        tags,
      })
      let { signal_long, debug_string_long } = long_result
      tags = long_result.tags

      // check for short entry
      let short_result = this.check_for_short_signal({
        candle,
        price_history_candles: this.price_history_candles_short,
        tags,
      })
      let { signal_short, debug_string_short } = short_result
      tags = short_result.tags

      // Check for entry signal in both directions and ignore
      // NB: this means the stored market direction isn't changed
      if (signal_long && signal_short) {
        // We could prefer short here instead but then that sets the market direction to long and we can
        // do more trades in choppy markets
        let msg = `${symbol} Price entry signal both long and short, skipping...`
        this.logger.warn(tags, msg)
        this.logger.warn(tags, `Warning: signalled both directions - persistent market direction not updated`)
        return
      }

      let direction: "long" | "short" | undefined = undefined
      if (signal_long) direction = "long"
      if (signal_short) direction = "short"
      if (direction) tags = { ...tags, direction }

      if (direction === undefined) {
        this.logger.debug(tags, `${symbol}: No signal: LONG - ${debug_string_long} SHORT - ${debug_string_short}`)
        return
      }

      /* Direction change filter */
      let previous_direction = await this.direction_persistance.get_direction(base_asset)
      tags.previous_direction = previous_direction || "(null)"
      await this.direction_persistance.set_direction(base_asset, direction)
      if (previous_direction === null) {
        let msg = `possible ${direction} signal on ${base_asset} - check manually if this is a trend reversal.`
        this.logger.warn(tags, msg)
        this.send_message(msg, tags)
        return
      }
      let direction_change = previous_direction !== direction
      if (!direction_change) {
        this.logger.debug(tags, `${symbol} ${direction} price triggered but not trend reversal`)
        return
      }

      let signal_price = candle["close"]
      let { market_identifier } = this

      let event: Edge70Signal = {
        object_type: "Edge70Signal",
        version: 1,
        // msg: `trend reversal ${direction_string} entry signal on ${base_asset} at ${days}d price ${signal_price.toFixed()}. ${market_data_string}`,
        msg: `${edge} ${direction} signal on ${base_asset} (${symbol})`,
        base_asset,
        direction,
        edge,
        market_identifier,
        edge70_parameters: this.edge70_parameters,
        signal: {
          direction,
          signal_price,
          signal_timestamp_ms,
        },
      }
      this.callbacks.publish(event)
    } catch (err) {
      this.logger.error(
        { tags },
        `Exception ingesting candle: ${err} - not storing candle, history probably incorrect - setting unhealthy`
      )
      this.logger.error({ err })
      this.health_and_readiness.healthy(false)
      this.health_and_readiness.ready(false)
      this.logger.error({ err })
      Sentry.captureException(err)
      throw err
    } finally {
      // important not to miss this - lest we corrupt the history
      this.price_history_candles_long.push(candle)
      this.price_history_candles_short.push(candle)
    }
  }
}
