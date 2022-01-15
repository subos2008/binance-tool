import { AlgoUtils } from "../../service_lib/binance_algo_utils_v2"
import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../events/shared/exchange-identifier"
import binance from "binance-api-node"
import { Binance } from "binance-api-node"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

interface SpotMarketBuyByQuoteQuantityCommand {
  market_identifier: MarketIdentifier_V3
  quote_amount: BigNumber
}

interface BinanceSpotStopLimitOrderCommand {}

export interface SpotExecutionEngine {
  get_market_identifier_for({
    quote_asset,
    base_asset,
  }: {
    quote_asset: string
    base_asset: string
  }): MarketIdentifier_V3
  market_buy_by_quote_quantity(args: SpotMarketBuyByQuoteQuantityCommand): Promise<void>
}

// Binance Keys
assert(process.env.APIKEY)
assert(process.env.APISECRET)

var ee: Binance = binance({
  apiKey: process.env.APIKEY || "foo",
  apiSecret: process.env.APISECRET || "foo",
})

export class BinanceSpotExecutionEngine implements SpotExecutionEngine {
  utils: AlgoUtils
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    assert(logger)
    this.logger = logger
    this.utils = new AlgoUtils({ logger, ee /* note global variable */ })
  }

  get_exchange_identifier(): ExchangeIdentifier_V3 {
    return {
      version: "v3",
      exchange: "binance",
      type: "spot",
    }
  }

  // Used when storing things like Position state
  get_market_identifier_for({
    quote_asset,
    base_asset,
  }: {
    quote_asset: string
    base_asset: string
  }): MarketIdentifier_V3 {
    return {
      version: "v3",
      exchange_identifier: this.get_exchange_identifier(),
      symbol: `${base_asset.toUpperCase()}${quote_asset.toUpperCase()}`,
      base_asset,
      quote_asset,
    }
  }

  async market_buy_by_quote_quantity(args: SpotMarketBuyByQuoteQuantityCommand) {
    // this.utils.create_market_buy_order()
  }

  open_stop_limit_order(args: BinanceSpotStopLimitOrderCommand) {}
}
