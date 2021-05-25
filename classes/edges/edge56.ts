/* New highs from the start of a bull market. Daily close vs highest daily close so far */

// TODO: after 10 days 1f still holding a position say if it's above or below entry price, tag edge56/trend-following/donchen-exits
//        - in cli/positions
//        - in position-tracker
// TODO: store entries made from here in redis so this service can restart, tag edge56/trendfollowing/donchen-exits
// TOOD: signal when open positions go under/over MA200 or MA50, whichever is available
// TODO: add coing-gekko as an exchange and the cli ability to add/adjust/set manual positions
// TOO:how can we run processing to exits - to free up capital before we run processing of new entries? Do potential new entries get stored instead of entered? Maybe entries go on a list for manual response
// TODO: add to position if we are >~30% up since entry price (daily close)
// TODO: stop out at 25% drawdown - presumably that's with just the initial position?
// TODO: we probably want some kind of limit so we don't buy the top of a 2x spike? Or given small position size maybe we are up for that.
// TODO: exit strat - we can do exit in a separate service if we tag positions with the edge in redis
// TODO: don't enter if we already have a position in this symbol
// TODO: check volume is higher than last 7 days volume for entry trigger

import { assert, time } from "console"

import { Binance, Candle, CandleChartInterval, CandleChartResult } from "binance-api-node"
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { CandleUtils } from "../../classes/utils/candle_utils"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

const humanNumber = require("human-number")

export interface Edge56EntrySignalsCallbacks {
  enter_position({
    symbol,
    entry_price,
    direction,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
  }): void
  in_position(symbol: string): boolean
}

export class Edge56EntrySignals {
  historical_candle_key: "high" | "close"
  current_candle_key: "high" | "close"
  historical_high_candle: CandleChartResult | Candle
  market_data: CoinGeckoMarketData

  symbol: string
  logger: Logger
  potential_new_high_detected: boolean = false
  callbacks: Edge56EntrySignalsCallbacks

  constructor({
    ee,
    logger,
    initial_candles,
    symbol,
    // historical_candle_key,
    // current_candle_key,
    market_data,
    callbacks,
  }: {
    ee: any
    logger: Logger
    initial_candles: CandleChartResult[]
    symbol: string
    // historical_candle_key: "high" | "close"
    // current_candle_key: "high" | "close"
    market_data: CoinGeckoMarketData
    callbacks: Edge56EntrySignalsCallbacks
  }) {
    this.historical_candle_key = 'high'
    this.current_candle_key = 'close'
    this.symbol = symbol
    this.logger = logger
    this.market_data = market_data
    this.callbacks = callbacks

    let { candle } = CandleUtils.get_highest_candle({ candles: initial_candles, key: this.historical_candle_key })
    this.set_high(candle)
  }

  // TODO: problem is I am assuming historical 'high' and 'entry high' use the same key. I could just hard code
  // at this stage but I need to make sure checks for entry high vs maintaining historical highs are discinct especially
  // with intial candle ingestion vs ingestion of new candles getting added. So one class does intial candles and
  // new candles for the history and has an interface
  private is_new_high_candle(candle: CandleChartResult | Candle) {
    return new BigNumber(candle[this.current_candle_key]).isGreaterThanOrEqualTo(
      this.historical_high_candle[this.historical_candle_key]
    )
  }

  private set_high(candle: CandleChartResult | Candle) {
    this.historical_high_candle = candle
    console.log(
      `${this.symbol} setting historical high to ${candle[this.historical_candle_key]} from ${new Date(
        candle.closeTime
      ).toString()}`
    )
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
    if (this.potential_new_high_detected) return // don't keep spamming with this alert
    let high = new BigNumber(candle.high)
    if (high.isGreaterThan(this.historical_high_candle[this.historical_candle_key])) {
      this.logger.info(
        `${this.symbol} Potential new high of ${high.toFixed()} since ${new Date(
          this.historical_high_candle.closeTime
        ).toString()}. MCAP ${humanNumber(new BigNumber(this.market_data.market_cap).toPrecision(2))} RANK: ${
          this.market_data.market_cap_rank
        }`
      )
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
    if (this.is_new_high_candle(candle)) this.set_high(candle)
    let potential_entry_price = new BigNumber(candle[this.current_candle_key])
    if (potential_entry_price.isGreaterThan(this.historical_high_candle[this.historical_candle_key])) {
      console.log(`Entry signal!! at ${potential_entry_price.toFixed()}, ${new Date(candle.closeTime)}`)
      this.callbacks.enter_position({ symbol: this.symbol, entry_price: potential_entry_price, direction: "long" })
    }
  }
}
