import { Binance, CandleChartInterval, CandleChartResult, Candle } from "binance-api-node"

import { BigNumber } from "bignumber.js"
import { assert } from "console"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export type FlexiCandle = CandleChartResult | Candle

export class LimitedLengthCandlesHistory {
  candles: FlexiCandle[]
  length: number
  key: "close" | "high"

  private limited_length_candle_array(length: number, initial_candles: FlexiCandle[]): FlexiCandle[] {
    var array: FlexiCandle[] = initial_candles.slice(-length)
    array.push = function () {
      if (this.length >= length) {
        this.shift()
      }
      return Array.prototype.push.apply(this, arguments)
    }
    return array
  }

  constructor({
    length,
    initial_candles,
    key,
  }: {
    length: number
    initial_candles: FlexiCandle[]
    key: "close" | "high"
  }) {
    this.candles = this.limited_length_candle_array(length, initial_candles)
    this.length = length
    this.key = key
  }

  push(candle: FlexiCandle) {
    this.candles.push(candle)
    assert(this.candles.length <= this.length)
  }

  get_highest_candle(key: string):FlexiCandle {
    return CandleUtils.get_highest_candle({ candles: this.candles, key: this.key })
  }
}

export class CandlesCollector {
  start_date: Date
  ee: Binance

  constructor({ ee }: { ee: any }) {
    this.ee = ee
  }

  async get_daily_candles_between({
    symbol,
    start_date,
    end_date,
  }: {
    symbol: string
    start_date: Date
    end_date?: Date
  }): Promise<CandleChartResult[]> {
    return this.ee.candles({
      symbol,
      interval: CandleChartInterval.ONE_DAY,
      startTime: start_date.getTime(),
      endTime: end_date?.getTime() || new Date().getTime(),
    })
  }
}

export class CandleUtils {
  static get_highest_candle({
    candles,
    key,
  }: {
    candles: FlexiCandle[]
    key: "close" | "high"
  }): { high: BigNumber; candle: FlexiCandle } {
    let high = new BigNumber(candles[0][key])
    let high_candle = candles[0]
    for (let i = 0; i < candles.length; i++) {
      let candle = candles[i]
      let daily_high_price = new BigNumber(candle[key])
      if (daily_high_price.isGreaterThan(high)) {
        high = daily_high_price
        high_candle = candle
      }
    }
    return { high, candle: high_candle }
  }

  find_first_daily_candle_with_close_higher_than_price(
    candles: CandleChartResult[],
    price: BigNumber
  ): { daily_close_price: BigNumber; index: number; candle: CandleChartResult } {
    for (let i = 0; i < candles.length; i++) {
      let candle = candles[i]
      let daily_close_price = new BigNumber(candle.close)
      if (daily_close_price.isGreaterThan(price)) {
        return { daily_close_price, index: i, candle }
      }
    }
    throw new Error("No higher daily close price found")
  }
}
