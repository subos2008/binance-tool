import { BigNumber } from "bignumber.js"
import assert from "node:assert"
import { ServiceLogger } from "../../../interfaces/logger"
import { PositionSizer } from "../../../interfaces/position-sizer"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export class BacktesterFixedPositionSizer implements PositionSizer {
  logger: ServiceLogger
  amount = new BigNumber(100)

  constructor({ logger }: { logger: ServiceLogger }) {
    assert(logger)
    this.logger = logger
    this.logger.event({}, { object_type: `[PositionSizer]`, msg: `Using ${this.id_slug()}` })
  }

  id_slug(): string {
    return `bf.${this.amount.toFixed()}`
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
    let tags = { base_asset, quote_asset, edge, direction }

    let { amount } = this

    this.logger.event(tags, {
      object_type: `FixedPositionSizer`,
      msg: `position fixed at ${amount} ${quote_asset}`,
    })

    return amount
  }
}
