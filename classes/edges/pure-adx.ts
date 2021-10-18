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
import { LimitedLengthCandlesHistory } from "../../classes/utils/candle_utils"

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

type ADX_RESULT_TYPE = [
  {
    "adx": number
    "mdi": number
    "pdi": number
  }
]

export class EntrySignals {
  symbol: string
  logger: Logger
  callbacks: EntrySignalsCallbacks
  adx: ADX
  color: string

  constructor({
    logger,
    initial_candles,
    symbol,
    // historical_candle_key,
    // current_candle_key,
    callbacks,
  }: {
    logger: Logger
    initial_candles: CandleChartResult[]
    symbol: string
    // historical_candle_key: "high" | "close"
    // current_candle_key: "high" | "close"
    callbacks: EntrySignalsCallbacks
  }) {
    this.symbol = symbol
    this.logger = logger
    this.callbacks = callbacks
    let reformed_candles: { close: number[]; high: number[]; low: number[]; period: number } = {
      close: [],
      high: [],
      low: [],
      period: adx_period,
    }
    initial_candles.forEach((x) => {
      reformed_candles.low.push(parseFloat(x.low))
      reformed_candles.close.push(parseFloat(x.close))
      reformed_candles.high.push(parseFloat(x.high))
    })
    this.adx = new ADX(reformed_candles)
    this.color = this.get_color(this.adx.getResult())
  }

  get_color(result: ADX_RESULT_TYPE): "green" | "red" | "black" {
    let i = result[-1]
    return i.adx > limadx && i.pdi > i.mdi ? "green" : i.adx > limadx && i.pdi < i.mdi ? "red" : "black"
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
      // Binance ws idosyncracy workaround
      console.log(`Short timeframe candle on ${this.symbol} closed at ${candle.close}`)
      throw `Got a short timeframe candle`
    }

    let entry_price = new BigNumber(candle["close"])

    // TODO: ingest new candle
    // process.exit(1)

    let result: ADX_RESULT_TYPE = this.adx.getResult()
    let color = this.get_color(result)
    let prev_color = this.color

    try {
      if (color === "green" && prev_color !== "green") {
        this.callbacks.entry_signal({ symbol, entry_price, direction: "long" })
      } else if (color === "red" && prev_color !== "red") {
        this.callbacks.entry_signal({ symbol, entry_price, direction: "short" })
      }
    } catch (e) {
      this.logger.error(`Exception checking or entering position: ${e}`)
      console.error(e)
    } finally {
      // important not to miss this - lest we corrupt the history
      this.color = color // update history
    }
  }
}
