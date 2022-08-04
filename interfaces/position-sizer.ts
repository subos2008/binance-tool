import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export interface PositionSizer {
  position_size_in_quote_asset(args: {
    base_asset: string
    quote_asset: string
    edge: string // check if authorised edge inside PositionSizer
    direction: "long" | "short"
  }): Promise<BigNumber>
}
