import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"

/** Configuration */
let fixed_position_size = {
  quote_asset: "BUSD",
  quote_amount: new BigNumber(200),
}

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export class FixedPositionSizer {
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    assert(logger)
    this.logger = logger
  }

  private position_size({ base_asset, quote_asset }: { base_asset: string; quote_asset: string }): {
    quote_amount: BigNumber
  } {
    assert(fixed_position_size.quote_asset === quote_asset)
    return { quote_amount: fixed_position_size.quote_amount }
  }
}
