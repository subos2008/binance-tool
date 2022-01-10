import { Binance, CandleChartInterval, CandleChartResult, Candle } from "binance-api-node"

import { BigNumber } from "bignumber.js"
import { assert } from "console"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export interface MiniCloseOpenOnlyCandle {
  close: string
  // open: string
}

export type FlexiCandle = CandleChartResult | Candle
export type Candle_OHLC = {
  low: string
  high: string
  open: string
  close: string
}
export type Candle_OC = {
  open: string
  close: string
}

export class CandlesCollector {
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

  async get_candles_between({
    symbol,
    start_date,
    end_date,
    timeframe,
  }: {
    symbol: string
    start_date: Date
    end_date?: Date
    timeframe: "1w"
  }): Promise<CandleChartResult[]> {
    return this.ee.candles({
      symbol,
      interval: CandleChartInterval.ONE_WEEK,
      startTime: start_date.getTime(),
      endTime: end_date?.getTime() || new Date().getTime(),
    })
  }
}

/**
 * I want a generic utility function that when given an array and a list of keys gives me the
 * higest/lowest value of any of the keys
 * */

export class CandleUtils {
  static get_lowest_candle({ candles, key }: { candles: FlexiCandle[]; key: "close" | "high" | "volume" }): {
    low: BigNumber
    candle: FlexiCandle
  } {
    let low = new BigNumber(candles[0][key])
    let low_candle = candles[0]
    for (let i = 0; i < candles.length; i++) {
      let candle = candles[i]
      let new_price = new BigNumber(candle[key])
      if (new_price.isLessThan(low)) {
        low = new_price
        low_candle = candle
      }
    }
    return { low, candle: low_candle }
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

export class CandleInfo_OC {
  candle: Candle_OC
  constructor(candle: Candle_OC) {
    this.candle = candle
  }
  is_short_candle(): boolean {
    return new BigNumber(this.candle.close).isLessThan(this.candle.open)
  }
  is_long_candle(): boolean {
    return !this.is_short_candle()
  }
  percentage_change(): BigNumber {
    let open = new BigNumber(this.candle.open)
    let close = new BigNumber(this.candle.close)
    return close.dividedBy(open).minus(1).times(100).dp(2)
  }
}
