import { strict as assert } from "assert"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../../lib/faux_logger"
import { OrderExecutionTracker } from "../../../classes/exchanges/binance/spot-order-execution-tracker"
import { Balance, Balance_with_quote_value, Portfolio, Prices } from "../../../interfaces/portfolio"
import { AssetBalance, Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"
import { RedisClient } from "redis"
import { ServiceLogger } from "../../../interfaces/logger"

export class PortfolioSnapshot {
  logger: ServiceLogger
  ee: BinanceType
  balances: AssetBalance[] | undefined

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
    this.balances = response.balances
    return this.balances
  }

  async with_quote_value(args: { quote_asset: string; prices: Prices }): Promise<Balance_with_quote_value[]> {
    if (!this.balances) return []

    let { quote_asset } = args
    let balances_with_quote_value: Balance_with_quote_value[] = []
    for (const p of this.balances) {
      let base_asset = p.asset
      let position_size = new BigNumber(p.free).plus(p.locked)
      let symbol = await this.exchange_info_getter.to_symbol({ base_asset, quote_asset })
      if (!symbol) throw new Error(`No symbol for ${base_asset}:${quote_asset}`)
      let current_price = args.prices[symbol]
      let quote_value = new BigNumber(current_price).times(position_size)
      positions.push({ ...p, quote_value, base_asset, quote_asset })
    }

    return balances_with_quote_value
  }
}
