import { assert } from "console"

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}
const moment = require("moment")

import { Logger } from "../../../interfaces/logger"
import { Edge58EntrySignal, Edge58Parameters_V1 } from "../../../events/shared/edge58"
import { CandleInfo_OC } from "../../utils/candle_utils"
import { MarketIdentifier_V2 } from "../../../events/shared/market-identifier"
import { ADX_Indicator } from "../../indicators/adx"
import { LimitedLengthCandlesHistory } from "./limited_length_candles_history"
import { Candle, Edge58EntrySignalsCallbacks } from "./interfaces"

export class Edge58EntrySignals {
  symbol: string
  logger: Logger

  callbacks: Edge58EntrySignalsCallbacks
  price_history_candles: LimitedLengthCandlesHistory
  edge58_parameters: Edge58Parameters_V1
  market_identifier: MarketIdentifier_V2
  adx_indicator: ADX_Indicator

  static required_initial_candles(edge58_parameters: Edge58Parameters_V1) {
    return Math.max(
      edge58_parameters.candles_of_price_history,
      ADX_Indicator.required_initial_candles(edge58_parameters.entry_filters.adx_parameters)
    )
  }

  constructor({
    logger,
    initial_candles,
    symbol,
    callbacks,
    edge58_parameters,
    market_identifier,
  }: {
    logger: Logger
    initial_candles: Candle[]
    symbol: string
    callbacks: Edge58EntrySignalsCallbacks
    edge58_parameters: Edge58Parameters_V1
    market_identifier: MarketIdentifier_V2
  }) {
    this.symbol = symbol
    this.logger = logger
    this.callbacks = callbacks
    this.edge58_parameters = edge58_parameters
    this.market_identifier = market_identifier
    this.adx_indicator = new ADX_Indicator({
      logger,
      symbol,
      adx_parameters: edge58_parameters.entry_filters.adx_parameters,
      initial_candles,
    })

    // Edge config - hardcoded as this should be static to the edge - short entry code expects close
    this.price_history_candles = new LimitedLengthCandlesHistory({
      length: edge58_parameters.candles_of_price_history,
      initial_candles,
    })
  }

  is_large_candle_body(candle: Candle) {
    return new CandleInfo_OC(candle)
      .percentage_change()
      .abs()
      .isGreaterThanOrEqualTo(this.edge58_parameters.entry_filters.candle_body_percentage_considered_too_large)
  }

  /* Direction chooses the wick, when short we set the stop above the top wick */
  get_stop_percentage(candle: Candle, direction: "long" | "short"): BigNumber {
    let stops = this.edge58_parameters.stops
    let wick_size: BigNumber
    if (direction === "long") {
      // wick is low to min(open, close)
      wick_size = BigNumber.min(candle.open, candle.close).minus(candle.low)
    } else if (direction === "short") {
      // wick is max(open, close) to high
      wick_size = new BigNumber(candle.high).minus(BigNumber.max(candle.open, candle.close))
    } else throw new Error(`unknown direction: ${direction}`)

    if (wick_size.isNegative()) throw new Error(`negative wick_size`)
    let body_size = BigNumber.max(candle.open, candle.close).minus(BigNumber.min(candle.open, candle.close))
    let wick_pcnt = wick_size.dividedBy(body_size).times(100)

    if (wick_pcnt.isGreaterThan(stops.wick_definitions_percentages_of_body.large_wick_greater_than))
      return new BigNumber(stops.stop_percentages.large_wick)
    if (wick_pcnt.isLessThan(stops.wick_definitions_percentages_of_body.minimal_wick_less_than))
      return new BigNumber(stops.stop_percentages.minimal_wick)
    return new BigNumber(stops.stop_percentages.default)
  }

  get_stop_price(candle: Candle, direction: "long" | "short"): BigNumber {
    let stop_percentage = this.get_stop_percentage(candle, direction)
    if (direction === "long") {
      // stop price X% under the low
      return new BigNumber(candle.low).times(new BigNumber(100).minus(stop_percentage).div(100))
    }
    if (direction === "short") {
      // stop price X% above the high
      return new BigNumber(candle.high).times(new BigNumber(100).plus(stop_percentage).div(100))
    }
    throw new Error(`unknown direction: ${direction}`)
  }

  is_adx_the_right_colour_to_enter(direction: "long" | "short"): boolean {
    // this.logger.warn(`ADX direction is not implemented - tests`)
    return true
  }

  async ingest_new_candle({ timeframe, candle, symbol }: { timeframe: string; symbol: string; candle: Candle }) {
    this.logger.info(`INGESTING CANDLE ${moment(candle.closeTime).format("YYYY MMM DD")} ${candle.close}`)

    if (timeframe !== this.edge58_parameters.candle_timeframe) {
      console.log(`Short timeframe ${timeframe} candle on ${this.symbol} closed at ${candle.close}`)
      throw new Error(`Got a short timeframe candle`)
    }

    try {
      let potential_entry_price = new BigNumber(candle["close"])
      let direction: "long" | "short" | undefined = undefined
      let enter_position_ok: boolean | undefined = undefined
      let add_to_position_ok: boolean | undefined = undefined

      // check for long entry
      if (potential_entry_price.isGreaterThan(this.price_history_candles.get_highest_body_value().high)) {
        direction = "long"
        enter_position_ok = !this.is_large_candle_body(candle) && this.is_adx_the_right_colour_to_enter(direction)
        add_to_position_ok = true // no filters on this
      }

      // check for short entry
      if (potential_entry_price.isLessThan(this.price_history_candles.get_lowest_body_value().low)) {
        direction = "short"
        enter_position_ok = !this.is_large_candle_body(candle) && this.is_adx_the_right_colour_to_enter(direction)
        add_to_position_ok = true // no filters on this
      }

      if (direction) {
        let stop_price = this.get_stop_price(candle, direction).toFixed()
        this.logger.info(
          `Price entry signal on ${symbol} ${direction} at ${potential_entry_price.toFixed()}: current candle "close" at ${potential_entry_price.toFixed()}: enter_position_ok: ${enter_position_ok} add_to_position_ok: ${add_to_position_ok}, stop_price: ${stop_price}`
        )
        if (enter_position_ok === undefined) throw new Error("enter_position_ok not calculated")
        if (add_to_position_ok === undefined) throw new Error("add_to_position_ok not calculated")
        let event: Edge58EntrySignal = {
          version: "v1",
          market_identifier: this.market_identifier,
          event_type: "Edge58EntrySignal",
          edge58_parameters: this.edge58_parameters,
          edge58_entry_signal: {
            direction,
            entry_price: potential_entry_price.toFixed(),
          },
          enter_position_ok,
          add_to_position_ok,
          entry_candle_close_timestamp_ms: candle.closeTime,
          stop_price,
        }
        this.callbacks.enter_or_add_to_position(event)
      }
    } catch (e) {
      this.logger.error(`Exception checking or entering position: ${e}`)
      console.error(e)
      throw e
    } finally {
      // important not to miss this - lest we corrupt the history
      this.price_history_candles.push(candle)
    }
  }
}
