import { BigNumber } from "bignumber.js"
import assert from "node:assert"
import { ServiceLogger } from "../../../interfaces/logger"
import { PositionSizer } from "../../../interfaces/position-sizer"
import { BankOfBacktesting } from "../portfolio-tracking/interfaces"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export class BacktesterAllInPositionSizer implements PositionSizer {
  logger: ServiceLogger
  bank: BankOfBacktesting

  constructor({ logger, bank }: { logger: ServiceLogger; bank: BankOfBacktesting }) {
    assert(logger)
    this.logger = logger
    this.bank = bank
  }

  id_slug(): string {
    return `b.ai`
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

    this.logger.warn(tags, `Someone is being silly and using the AllInPositionSizer...`)

    this.bank.balances().cash
    return this.bank.balances().cash
  }
}
