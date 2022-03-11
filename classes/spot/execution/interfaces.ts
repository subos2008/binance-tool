import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { AuthorisedEdgeType } from "../abstractions/position-identifier";

export interface PositionEntryArgs {
    quote_asset: string
    base_asset: string
    direction: string
    edge: AuthorisedEdgeType
}

export interface PositionEntryReturn {
  executed_quote_quantity: string
  stop_order_id: string | number | undefined
  executed_price: BigNumber
  stop_price: BigNumber
}

export interface PositionEntryExecutor {
 open_position(args: PositionEntryArgs): Promise<PositionEntryReturn>
}
