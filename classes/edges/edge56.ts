/* New highs from the start of a bull market. Daily close vs highest daily close so far */

// TODO: after 10 days 1f still holding a position say if it's above or below entry price, tag edge56/trend-following/donchen-exits
//        - in cli/positions
//        - in position-tracker
// TODO: store entries made from here in redis so this service can restart, tag edge56/trendfollowing/donchen-exits
// TOOD: signal when open positions go under/over MA200 or MA50, whichever is available
// TODO: add coin-gekko as an exchange and the cli ability to add/adjust/set manual positions
// TODO: add to position if we are >~30% up since entry price (daily close)

// TODO: Entry
// 1. Add MACD
// 2. Short entries don't need volume as a confirmation

// TODO: Exits
// 1. Stop loss: 25% or 10% from entry
// 2. time based: if it's not up after 10 days cut it
// 3. Chandelier
// 4. edge short entry signal
// 5. Peter Brandt style exit: high candle, setup candle, exit: https://www.youtube.com/watch?v=kxjYGO-N1VA at 9-12 minutes

// TODO: Increase Position Size
// 1. Breakout of Donchien channel (new high after a range period). The question is does a day of down followed the next day by a Donchien channel breakout count..

import { assert } from "console"

import { Candle, CandleChartResult } from "binance-api-node"
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"
import { Edge56Parameters } from "../../events/shared/edge56-position-entry"

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

export interface EdgeCandle {
  // The candle interface required by this edge
  close: string
  open: string
  volume: string
}

class LimitedLengthCandlesHistory {
  private candles: EdgeCandle[]
  length: number

  // Patch an array object with overrided push() function
  private limited_length_candle_array(length: number, initial_candles: EdgeCandle[]): EdgeCandle[] {
    var array: EdgeCandle[] = initial_candles.slice(-length)
    array.push = function () {
      if (this.length >= length) {
        this.shift()
      }
      return Array.prototype.push.apply(this, arguments as any) // typscript didn't like this
    }
    return array
  }

  constructor({ length, initial_candles }: { length: number; initial_candles: EdgeCandle[] }) {
    this.candles = this.limited_length_candle_array(length, initial_candles)
    this.length = length
  }

  push(candle: EdgeCandle) {
    this.candles.push(candle)
    assert(this.candles.length <= this.length)
  }

  get_highest_body_value(): { high: BigNumber; candle: EdgeCandle } {
    function candle_high_body_value(candle: EdgeCandle) {
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

  get_lowest_body_value(): { low: BigNumber; candle: EdgeCandle } {
    function candle_low_body_value(candle: EdgeCandle) {
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

  // get_highest_volume(): { volume_high: BigNumber; candle: EdgeCandle } {
  //   function candle_volume(candle: EdgeCandle) {
  //     return new BigNumber(candle["volume"])
  //   }
  //   let volume_high: BigNumber = candle_volume(this.candles[0])
  //   let high_candle: EdgeCandle = this.candles[0]
  //   for (let i = 0; i < this.candles.length; i++) {
  //     let i_candle = this.candles[i]
  //     let i_volume = candle_volume(i_candle)
  //     if (i_volume.isGreaterThan(volume_high)) {
  //       volume_high = i_volume
  //       high_candle = i_candle
  //     }
  //   }
  //   return { volume_high, candle: high_candle }
  // }
}

export class Edge56EntrySignals {
  symbol: string
  logger: Logger
  market_data: CoinGeckoMarketData

  callbacks: Edge56EntrySignalsCallbacks
  price_history_candles: LimitedLengthCandlesHistory

  constructor({
    logger,
    initial_candles,
    symbol,
    market_data,
    callbacks,
    edge56_parameters,
  }: {
    logger: Logger
    initial_candles: CandleChartResult[]
    symbol: string
    market_data: CoinGeckoMarketData
    callbacks: Edge56EntrySignalsCallbacks
    edge56_parameters: Edge56Parameters
  }) {
    this.symbol = symbol
    this.logger = logger
    this.market_data = market_data
    this.callbacks = callbacks

    // Edge config - hardcoded as this should be static to the edge - short entry code expects close
    this.price_history_candles = new LimitedLengthCandlesHistory({
      length: edge56_parameters.days_of_price_history,
      initial_candles,
    })
  }

  async ingest_new_candle({
    timeframe,
    candle,
    symbol,
  }: {
    timeframe: string
    symbol: string
    candle: EdgeCandle
  }) {
    if (timeframe !== "1d") {
      console.log(`Short timeframe candle on ${this.symbol} closed at ${candle.close}`)
      throw `Got a short timeframe candle`
    }

    try {
      let potential_entry_price = new BigNumber(candle["close"])
      // let potential_entry_volume = new BigNumber(candle["volume"])

      let direction: "long" | "short" | undefined = undefined

      // check for long entry
      let { high: highest_price } = this.price_history_candles.get_highest_body_value()
      if (potential_entry_price.isGreaterThan(highest_price)) {
        direction = "long"
        console.log(
          `Price entry signal on ${symbol} ${direction} at ${potential_entry_price.toFixed()}: greater than ${highest_price.toFixed()}`
        )
        // if (potential_entry_volume.isGreaterThan(this.price_history_candles.get_highest_volume().volume_high)) {
        //   console.log(`Volume entry signal on ${symbol} ${direction} at ${potential_entry_price.toFixed()}`)
        // } else {
        //   console.log(`Volume entry filter failed on ${symbol} ${direction} at ${potential_entry_price.toFixed()}`)
        //   return // no volume = no entry
        // }
        this.callbacks.enter_position({
          symbol: this.symbol,
          entry_price: potential_entry_price,
          direction,
        })
      }

      // check for short entry
      if (potential_entry_price.isLessThan(this.price_history_candles.get_lowest_body_value().low)) {
        let direction: "short" = "short"
        console.log(
          `${symbol} Price entry signal ${direction} at ${potential_entry_price.toFixed()}`
        )
        this.callbacks.enter_position({
          symbol: this.symbol,
          entry_price: potential_entry_price,
          direction,
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
