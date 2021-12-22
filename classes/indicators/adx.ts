// Example test code from the repo: https://github.com/anandanand84/technicalindicators/blob/master/test/directionalmovement/ADX.js
// // TODO: ADX grown indefinitely, perhaps, result is always an array

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { ADX } from "technicalindicators"

import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { ADXOutput } from "technicalindicators/declarations/directionalmovement/ADX"

export type ADX_STRING_CANDLE = {
  high: string
  low: string
  close: string
}

export type ADX_parameters = {
  adx_period: 14
  limadx: 14
}

export class ADX_Indicator {
  symbol: string
  logger: Logger
  adx: ADX
  color: string
  prev_color: string
  current_result: ADXOutput | undefined
  adx_parameters: ADX_parameters

  static required_initial_candles(adx_parameters: ADX_parameters) {
    return Math.max(adx_parameters.limadx, adx_parameters.adx_period) // TODO: this is probably wrong
  }

  constructor({
    logger,
    initial_candles,
    symbol,
    adx_parameters,
  }: {
    logger: Logger
    initial_candles: ADX_STRING_CANDLE[]
    symbol: string
    adx_parameters: ADX_parameters
  }) {
    this.symbol = symbol
    this.logger = logger
    this.adx_parameters = adx_parameters

    // Sadly the adx library uses floating point
    let reformed_candles: { close: number[]; high: number[]; low: number[] } = {
      close: [],
      high: [],
      low: [],
    }

    let adx_period = adx_parameters.adx_period

    initial_candles.forEach((x) => {
      reformed_candles.low.push(parseFloat(x.low))
      reformed_candles.close.push(parseFloat(x.close))
      reformed_candles.high.push(parseFloat(x.high))
    })
    this.adx = new ADX({ ...reformed_candles, period: adx_period })
    try {
      this.color = this.get_color(this.adx.getResult())
    } catch (e) {
      this.color = "undefined"
    }
  }

  get_color(i: ADXOutput): "green" | "red" | "black" {
    let limadx = this.adx_parameters.limadx
    console.log(i)
    return i.adx > limadx && i.pdi > i.mdi ? "green" : i.adx > limadx && i.pdi < i.mdi ? "red" : "black"
  }

  can_enter(direction: "long" | "short") {
    if (direction === "long" && this.color === "green") return true
    if (direction === "short" && this.color === "red") return true
    if (!this.color) this.logger.warn(`ADX indicator not ready`)
    return false
  }

  current_color() {
    return this.color
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

    this.current_result = this.adx.nextValue(Number(candle.close))
    if (this.current_result) {
      // why if? what if undefined? not ready to signal yet?
      this.prev_color = this.color
      this.color = this.get_color(this.current_result)
    }
  }
}
