import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export interface LongShortEntrySignalsCallbacks {
  enter_position({
    symbol,
    entry_price,
    direction,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
  }): void
}

export interface StoredCandle {
  // The candle interface required by this edge
  close: string
  low: string
  high: string
  closeTime: number // milliseconds
}

export interface IngestionCandle {
  // The candle interface required by this edge
  close: string
  low: string
  high: string
  isFinal: boolean
  closeTime: number // milliseconds
}

export interface PositionEntryArgs {
  symbol: string
  entry_price: BigNumber
  direction: "long" | "short"
}
