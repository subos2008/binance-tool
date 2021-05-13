import { Binance, CandleChartInterval, CandleChartResult } from "binance-api-node"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export class CandlesCollector {
  start_date: Date
  ee: Binance

  constructor({ ee }: { ee: any}) {
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
  static get_highest_price(candles: CandleChartResult[]): BigNumber {
    let high = new BigNumber(candles[0].high)
    for (let i = 0; i < candles.length; i++) {
      let candle = candles[i]
      let daily_high_price = new BigNumber(candle.high)
      if (daily_high_price.isGreaterThan(high)) {
        high = daily_high_price
      }
    }
    return high
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
