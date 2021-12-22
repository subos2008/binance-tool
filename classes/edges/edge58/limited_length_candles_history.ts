import { assert } from "console"

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Candle } from "./interfaces"


export class LimitedLengthCandlesHistory {
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
