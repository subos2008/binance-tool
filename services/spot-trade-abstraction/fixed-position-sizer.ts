import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

/** Configuration */
let fixed_position_size = {
  quote_asset: "BUSD",
  quote_amount: new BigNumber(150),
}
export interface PositionSizer {
  position_size_in_quote_asset(args: { base_asset: string; quote_asset: string }): Promise<BigNumber>
}
export class FixedPositionSizer implements PositionSizer {
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    assert(logger)
    this.logger = logger
  }

  async position_size_in_quote_asset({
    base_asset,
    quote_asset,
  }: {
    base_asset: string
    quote_asset: string
  }): Promise<BigNumber> {
    assert(fixed_position_size.quote_asset === quote_asset)
    return fixed_position_size.quote_amount
  }
}
