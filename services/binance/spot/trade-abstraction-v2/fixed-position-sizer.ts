import { Logger } from "../../../../interfaces/logger"
import { strict as assert } from "assert"

import { BigNumber } from "bignumber.js"
import { AuthorisedEdgeType, check_edge } from "../../../../classes/spot/abstractions/position-identifier"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export interface PositionSizer {
  position_size_in_quote_asset(args: {
    base_asset: string
    quote_asset: string
    edge: string
  }): Promise<BigNumber>
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
    edge,
  }: {
    base_asset: string
    quote_asset: string
    edge: string
  }): Promise<BigNumber> {
    check_edge(edge)
    return new BigNumber(100)
  }
}