import { assert, time } from "console"

import { Binance, Candle, CandleChartInterval, CandleChartResult } from "binance-api-node"
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { CandlesCollector, CandleUtils } from "../../classes/utils/candle_utils"

type SendMessageFunc = (msg: string) => void
export class Edge56 {
  current_high: BigNumber
  latest_price: BigNumber

  in_position: boolean = false
  entry_price: BigNumber
  lowest_price_seen_since_entry: BigNumber
  symbol: string
  send_message: SendMessageFunc
  logger: Logger
  potential_new_high_detected: boolean = false

  constructor({
    ee,
    logger,
    initial_candles,
    symbol,
    send_message,
  }: {
    ee: any
    logger: Logger
    initial_candles: CandleChartResult[]
    symbol: string
    send_message: SendMessageFunc
  }) {
    this.current_high = CandleUtils.get_highest_close_price(initial_candles)
    this.symbol = symbol
    this.logger = logger
    this.send_message = send_message
  }

  private async enter_position(candle: CandleChartResult | Candle) {
    let price = new BigNumber(candle.close)
    if (this.in_position) throw new Error(`Already in position`)
    this.in_position = true
    console.log(`Position entry triggered at price: ${price.toFixed()}`)
    this.lowest_price_seen_since_entry = price
    this.entry_price = price
  }

  percentage_change_since_entry(price: BigNumber) {
    return price.minus(this.entry_price).dividedBy(this.entry_price).times(100).dp(1)
  }
  async ingest_intercandle_close_update_candle({
    timeframe,
    candle,
    symbol,
  }: {
    timeframe: string
    symbol: string
    candle: Candle
  }) {
    if (this.potential_new_high_detected) return
    if (new BigNumber(candle.high).isGreaterThan(this.current_high)) {
      this.send_message(`Potential new high on ${this.symbol}`)
      this.potential_new_high_detected = true // just do this once per candle
    }
  }
  async ingest_new_candle({
    timeframe,
    candle,
    symbol,
  }: {
    timeframe: string
    symbol: string
    candle: CandleChartResult | Candle
  }) {
    if (timeframe !== "1d") {
      console.log(`Short timeframe candle on ${this.symbol} closed at ${candle.close}`)
    }
    this.potential_new_high_detected = false // reset
    // TODO: shit we need to adjust the high too - if we get a wick but not a close?
    // TODO: add to position if we are >~30% up since entry price (daily close)
    // TODO: stop out at 25% drawdown - presumably that's with just the initial position?
    // TODO: we probably want some kind of limit so we don't buy the top of a 2x spike? Or given small position size maybe we are up for that.
    // TODO: exit strat - we can do exit in a separate service if we tag positions with the edge in redis
    // TODO: don't enter if we already have a position in this symbol
    this.latest_price = new BigNumber(candle.close)
    if (this.in_position) {
      let low = new BigNumber(candle.low)
      if (low.isLessThan(this.lowest_price_seen_since_entry)) {
        this.lowest_price_seen_since_entry = low
        console.warn(`Drawdown is now: ${this.percentage_change_since_entry(low)}`)
      }
    } else if (new BigNumber(candle.high).isGreaterThan(this.current_high)) {
      console.log(`Entry!! at ${candle.close}, ${new Date(candle.closeTime)}`)
      this.enter_position(candle)
    }
  }

  surmise_position() {
    console.log(`In Position: ${this.in_position}`)
  }
}
