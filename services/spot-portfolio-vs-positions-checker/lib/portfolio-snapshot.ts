import { strict as assert } from "assert"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../../lib/faux_logger"
import { OrderExecutionTracker } from "../../../classes/exchanges/binance/spot-order-execution-tracker"
import { Balance, Portfolio } from "../../../interfaces/portfolio"
import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"
import { RedisClient } from "redis"
import { ServiceLogger } from "../../../interfaces/logger"

export class PortfolioSnapshot {
  logger: ServiceLogger
  ee: BinanceType

  constructor({ logger }: { logger: ServiceLogger; redis: RedisClient }) {
    assert(logger)
    this.logger = logger

    logger.info("Live monitoring mode")
    if (!process.env.BINANCE_API_KEY) throw new Error(`Missing BINANCE_API_KEY in ENV`)
    if (!process.env.BINANCE_API_SECRET) throw new Error(`Missing BINANCE_API_SECRET in ENV`)
    this.ee = Binance({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
    })
  }

  async take_snapshot(): Promise<Balance[]> {
    let response = await this.ee.accountInfo()
    let balances = response.balances
    return balances
  }
}
