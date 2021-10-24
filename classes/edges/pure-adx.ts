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

// Example test code from the repo: https://github.com/anandanand84/technicalindicators/blob/master/test/directionalmovement/ADX.js
// TODO: ADX grown indefinitely, perhaps, result is always an array

import { Candle, CandleChartResult } from "binance-api-node"
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}
import { ADX } from "technicalindicators"
const adx_period = 14
const limadx = 14

import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { ADXOutput } from "technicalindicators/declarations/directionalmovement/ADX"

export interface EntrySignalsCallbacks {
  entry_signal({
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

export type ADX_CANDLE = {
  high: number
  low: number
  close: number
}

export type ADX_STRING_CANDLE = {
  high: string
  low: string
  close: string
}
export class EntrySignals {
  symbol: string
  logger: Logger
  callbacks: EntrySignalsCallbacks
  adx: ADX
  color: string
  prev_color: string
  current_result: ADXOutput | undefined

  constructor({
    logger,
    initial_candles,
    symbol,
    // historical_candle_key,
    // current_candle_key,
    callbacks,
  }: {
    logger: Logger
    initial_candles: ADX_STRING_CANDLE[]
    symbol: string
    // historical_candle_key: "high" | "close"
    // current_candle_key: "high" | "close"
    callbacks: EntrySignalsCallbacks
  }) {
    this.symbol = symbol
    this.logger = logger
    this.callbacks = callbacks
    // Sadly the adx library uses floating point
    let reformed_candles: { close: number[]; high: number[]; low: number[]} = {
      close: [],
      high: [],
      low: [],
    }
    initial_candles.forEach((x) => {
      reformed_candles.low.push(parseFloat(x.low))
      reformed_candles.close.push(parseFloat(x.close))
      reformed_candles.high.push(parseFloat(x.high))
    })
    this.adx = new ADX({...reformed_candles, period: adx_period})
    try {
      this.color = this.get_color(this.adx.getResult())
    } catch (e) {
      this.color = "undefined"
    }
  }

  get_color(i: ADXOutput): "green" | "red" | "black" {
    console.log(i)
    return i.adx > limadx && i.pdi > i.mdi ? "green" : i.adx > limadx && i.pdi < i.mdi ? "red" : "black"
  }

  async ingest_new_candle({
    timeframe,
    candle,
    symbol,
  }: {
    timeframe: string
    symbol: string
    candle: ADX_STRING_CANDLE
  }) {
    if (timeframe !== "1d") {
      // Binance ws idosyncracy workaround
      console.log(`Short timeframe candle on ${this.symbol} closed at ${candle.close}`)
      throw `Got a short timeframe candle`
    }

    let entry_price = new BigNumber(candle["close"])

    this.current_result = this.adx.nextValue(candle as any)
    if (this.current_result) {
      this.prev_color = this.color
      this.color = this.get_color(this.current_result)
    }

    try {
      if (this.color === "green" && this.prev_color !== "green") {
        this.callbacks.entry_signal({ symbol, entry_price, direction: "long" })
      } else if (this.color === "red" && this.prev_color !== "red") {
        this.callbacks.entry_signal({ symbol, entry_price, direction: "short" })
      }
    } catch (e) {
      this.logger.error(`Exception checking or entering position: ${e}`)
      console.error(e)
    }
  }
}
