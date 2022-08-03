import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { strict as assert } from "assert"

import { StoredCandle } from "./interfaces/_internal"

export class LimitedLengthCandlesHistory {
  private candles: StoredCandle[]
  private length: number

  // Patch an array object with overrided push() function
  private limited_length_candle_array(length: number, initial_candles: StoredCandle[]): StoredCandle[] {
    var array: StoredCandle[] = initial_candles.slice(-length)
    array.push = function (...items) {
      if(items.length != 1) throw new Error(`LimitedLengthCandlesHistory implementation only accespts push of one item`)
      if (this.length >= length) {
        this.shift()
      }
      return Array.prototype.push.apply(this, items)
    }
    return array
  }

  constructor({ length, initial_candles }: { length: number; initial_candles: StoredCandle[] }) {
    this.candles = this.limited_length_candle_array(length, initial_candles)
    this.length = length
  }

  full(): boolean {
    return this.current_number_of_stored_candles() >= this.required_number_of_stored_candles()
  }

  current_number_of_stored_candles(): number {
    return this.candles.length
  }

  required_number_of_stored_candles(): number {
    return this.length
  }

  push(candle: StoredCandle) {
    this.candles.push(candle)
    assert(this.candles.length <= this.length)
  }

  get_highest_value(): { high: BigNumber; candle: StoredCandle } {
    if (!this.candles[0]) throw new Error(`Asking for info from an empty LimitedLengthCandlesHistory, stored: ${this.current_number_of_stored_candles()}`)
    function candle_high_value(candle: StoredCandle) {
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

  get_lowest_value(): { low: BigNumber; candle: StoredCandle } {
    if (!this.candles[0]) throw new Error(`Asking for info from an empty LimitedLengthCandlesHistory, stored: ${this.current_number_of_stored_candles()}`)
    function candle_low_value(candle: StoredCandle) {
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
