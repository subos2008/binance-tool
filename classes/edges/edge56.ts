import { assert } from "console"

import { Binance, CandleChartInterval, CandleChartResult } from "binance-api-node"
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { CandlesCollector, CandleUtils } from "../../classes/utils/candle_utils"

export class Edge56 {
  current_high: BigNumber
  latest_price: BigNumber

  in_position: boolean = false
  entry_price: BigNumber
  lowest_price_seen_since_entry: BigNumber

  constructor({ ee, logger, initial_candles }: { ee: any; logger: Logger; initial_candles: CandleChartResult[] }) {
    this.current_high = CandleUtils.get_highest_price(initial_candles)
  }

  private async enter_position(candle: CandleChartResult) {
    let price = new BigNumber(candle.close)
    if (this.in_position) throw new Error(`Already in position`)
    this.in_position = true
    console.log(`Entering position at price: ${price.toFixed()}`)
    this.lowest_price_seen_since_entry = price
    this.entry_price = price
  }

  percentage_change_since_entry(price: BigNumber) {
    return price.minus(this.entry_price).dividedBy(this.entry_price).times(100).dp(1)
  }

  async ingest_new_candle({ candle, symbol }: { symbol: string; candle: CandleChartResult }) {
    this.latest_price = new BigNumber(candle.close)
    // TODO: exit strat
    if (this.in_position) {
      let low = new BigNumber(candle.low)
      if (low.isLessThan(this.lowest_price_seen_since_entry)) {
        this.lowest_price_seen_since_entry = low
        console.warn(`Drawdown is now: ${this.percentage_change_since_entry(low)}`)
      }
    } else if (new BigNumber(candle.close).isGreaterThan(this.current_high)) {
      console.log(`Entry!! at ${candle.close}, ${new Date(candle.closeTime)}`)
      this.enter_position(candle)
    }
  }

  surmise_position() {
    console.log(`In Position: ${this.in_position}`)
  }
}
