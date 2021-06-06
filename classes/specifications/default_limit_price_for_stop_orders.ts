import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

const default_limit_percentage_down = new BigNumber(15)

export function get_limit_price_for_stop_order({ stop_price }: { stop_price: BigNumber }): BigNumber {
  return stop_price.times(new BigNumber(100).minus(default_limit_percentage_down).dividedBy(100))
}
