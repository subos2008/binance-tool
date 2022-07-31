
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export interface LongShortSignalCallbacks {
  process_long_short_signal(args: LongShortSignal): void
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
