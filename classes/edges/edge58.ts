import { assert } from "console"

// import { Candle, CandleChartResult } from "binance-api-node"
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { Edge58Parameters } from "../../events/shared/edge58-position-entry"
import { CandleInfo_OC } from "../utils/candle_utils"

export interface Candle {
  open: string
  close: string
  // low: string // wicks needed for stops
  // high: string
}

class LimitedLengthCandlesHistory {
  private candles: Candle[]
  length: number

  // Patch an array object with overrided push() function
  private limited_length_candle_array(length: number, initial_candles: Candle[]): Candle[] {
    var array: Candle[] = initial_candles.slice(-length)
    array.push = function () {
      if (this.length >= length) {
        this.shift()
      }
      return Array.prototype.push.apply(this, arguments)
    }
    return array
  }

  constructor({ length, initial_candles }: { length: number; initial_candles: Candle[] }) {
    this.candles = this.limited_length_candle_array(length, initial_candles)
    this.length = length
  }

  push(candle: Candle) {
    this.candles.push(candle)
    assert(this.candles.length <= this.length)
  }

  get_highest_body_value(): { high: BigNumber; candle: Candle } {
    function candle_high_body_value(candle: Candle) {
      return BigNumber.max(candle["open"], candle["close"])
    }
    let high = candle_high_body_value(this.candles[0])
    let high_candle = this.candles[0]
    for (let i = 0; i < this.candles.length; i++) {
      let candle = this.candles[i]
      let candle_high_price = candle_high_body_value(candle)
      if (candle_high_price.isGreaterThan(high)) {
        high = candle_high_price
        high_candle = candle
      }
    }
    return { high, candle: high_candle }
  }

  get_lowest_body_value(): { low: BigNumber; candle: Candle } {
    function candle_low_body_value(candle: Candle) {
      return BigNumber.min(candle["open"], candle["close"])
    }
    let low = candle_low_body_value(this.candles[0])
    let low_candle = this.candles[0]
    for (let i = 0; i < this.candles.length; i++) {
      let candle = this.candles[i]
      let candle_low_price = candle_low_body_value(candle)
      if (candle_low_price.isLessThan(low)) {
        low = candle_low_price
        low_candle = candle
      }
    }
    return { low, candle: low_candle }
  }
}

export interface Edge58EntrySignalsCallbacks {
  // We might have different filters on enter position or add to position
  // Maybe we should add the entry candle info here too
  enter_or_add_to_position({
    symbol,
    entry_price,
    direction,
    enter_position_ok,
    add_to_position_ok,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
    enter_position_ok: boolean
    add_to_position_ok: boolean
  }): void
}

export class Edge58EntrySignals {
  symbol: string
  logger: Logger

  callbacks: Edge58EntrySignalsCallbacks
  price_history_candles: LimitedLengthCandlesHistory
  edge58_parameters: Edge58Parameters

  constructor({
    logger,
    initial_candles,
    symbol,
    callbacks,
    edge58_parameters,
  }: {
    logger: Logger
    initial_candles: Candle[]
    symbol: string
    callbacks: Edge58EntrySignalsCallbacks
    edge58_parameters: Edge58Parameters
  }) {
    this.symbol = symbol
    this.logger = logger
    this.callbacks = callbacks
    this.edge58_parameters = edge58_parameters

    // Edge config - hardcoded as this should be static to the edge - short entry code expects close
    this.price_history_candles = new LimitedLengthCandlesHistory({
      length: edge58_parameters.candles_of_price_history,
      initial_candles,
    })
  }

  is_large_candle_body(candle: Candle) {
    return new CandleInfo_OC(candle).percentage_change().abs().isGreaterThanOrEqualTo(35)
  }

  is_adx_the_right_colour_to_enter(direction: "long" | "short"): boolean {
    this.logger.warn(`ADX direction is not implemented - tests`)
    return true
  }

  async ingest_new_candle({ timeframe, candle, symbol }: { timeframe: string; symbol: string; candle: Candle }) {
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
        this.logger.info(
          `Price entry signal on ${symbol} ${direction} at ${potential_entry_price.toFixed()}: current candle "close" at ${potential_entry_price.toFixed()}: enter_position_ok: ${enter_position_ok} add_to_position_ok: ${add_to_position_ok}`
        )
        if (enter_position_ok === undefined) throw new Error("enter_position_ok not calculated")
        if (add_to_position_ok === undefined) throw new Error("add_to_position_ok not calculated")
        this.callbacks.enter_or_add_to_position({
          symbol: this.symbol,
          entry_price: potential_entry_price,
          direction,
          enter_position_ok,
          add_to_position_ok,
        })
      }
    } catch (e) {
      this.logger.error(`Exception checking or entering position: ${e}`)
      console.error(e)
    } finally {
      // important not to miss this - lest we corrupt the history
      this.price_history_candles.push(candle)
    }
  }
}
