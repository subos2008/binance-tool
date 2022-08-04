import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { PositionSizer } from "../../interfaces/position-sizer"

export class FixedPositionSizer implements PositionSizer {
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    assert(logger)
    this.logger = logger
  }

  async position_size_in_quote_asset({
    base_asset,
    quote_asset,
    edge,
    direction,
  }: {
    base_asset: string
    quote_asset: string
    edge: string
    direction: "short" | "long"
  }): Promise<BigNumber> {
    if (edge === "edge62") {
      if (direction === "short") return new BigNumber(600) // make this $1k if we can
      if (direction === "long") return new BigNumber(50)
    }
    if (edge === "edge60") {
      return new BigNumber(30)
    }
    if (edge === "edge70") {
      return new BigNumber(100)
    }
    this.logger.warn(`Using default position size`)
    return new BigNumber(20)
  }
}
