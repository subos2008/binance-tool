import BigNumber from "bignumber.js"
import { Edge70Signal } from "./edge70-signal"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export interface Edge70SignalCallbacks {
  publish(args: Edge70Signal): Promise<void>
  init(): Promise<void> // call before use
}

export interface EdgeCandle {
  // The candle interface required by this edge
  close: string
  low: string
  high: string
  closeTime: number // milliseconds
}

export interface StoredCandle {
  // The candle interface required by this edge
  close: string
  low: string
  high: string
  closeTime: number // milliseconds
}

export interface LongShortSignal {
  symbol: string
  trigger_price: BigNumber
  signal_price: BigNumber
  direction: "long" | "short"
  signal_timestamp_ms: number
}
