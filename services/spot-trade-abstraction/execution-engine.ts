import { AlgoUtils } from "../../service_lib/binance_algo_utils_v2"
import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../events/shared/exchange-identifier"
import binance from "binance-api-node"
import { Binance, ExchangeInfo } from "binance-api-node"

import { BigNumber } from "bignumber.js"
import { BinanceExchangeInfoGetter } from "../../classes/exchanges/binance/exchange-info-getter"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export interface SpotMarketBuyByQuoteQuantityCommand {
  market_identifier: MarketIdentifier_V3
  quote_amount: BigNumber
}

export interface SpotStopMarketSellCommand {
  market_identifier: MarketIdentifier_V3
  base_amount: BigNumber
  trigger_price: BigNumber
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

  market_buy_by_quote_quantity(
    args: SpotMarketBuyByQuoteQuantityCommand
  ): Promise<{ executed_quote_quantity: BigNumber; executed_price: BigNumber; executed_base_quantity: BigNumber }>

  get_exchange_identifier(): ExchangeIdentifier_V3

  stop_market_sell(cmd: SpotStopMarketSellCommand): Promise<{ order_id: string | number }>
}

// Binance Keys
assert(process.env.BINANCE_API_KEY)
assert(process.env.BINANCE_API_SECRET)

var ee: Binance = binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
})

export class BinanceSpotExecutionEngine implements SpotExecutionEngine {
  utils: AlgoUtils
  logger: Logger
  ei_getter: BinanceExchangeInfoGetter

  constructor({ logger }: { logger: Logger }) {
    assert(logger)
    this.logger = logger
    this.utils = new AlgoUtils({ logger, ee /* note global variable */ })
    this.ei_getter = new BinanceExchangeInfoGetter({ ee })
  }

  get_exchange_identifier(): ExchangeIdentifier_V3 {
    return {
      version: "v3",
      exchange: "binance",
      type: "spot",
    }
  }

  async get_exchange_info(): Promise<ExchangeInfo> {
    return await this.ei_getter.get_exchange_info()
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

  async market_buy_by_quote_quantity(cmd: SpotMarketBuyByQuoteQuantityCommand): Promise<{
    executed_quote_quantity: BigNumber
    executed_base_quantity: BigNumber
    executed_price: BigNumber
  }> {
    let result = await this.utils.create_market_buy_order_by_quote_amount({
      pair: cmd.market_identifier.symbol,
      quote_amount: cmd.quote_amount,
    })
    if (result) {
      return {
        executed_quote_quantity: new BigNumber(result.cummulativeQuoteQty),
        executed_base_quantity: new BigNumber(result.executedQty),
        executed_price: new BigNumber(result.price),
      }
    }
    throw new Error(`Something bad happened executing market_buy_by_quote_quantity`)
  }

  async stop_market_sell(cmd: SpotStopMarketSellCommand) {
    let result = await this.utils.create_stop_market_sell_order({
      exchange_info: await this.get_exchange_info(),
      base_amount: cmd.base_amount,
      pair: cmd.market_identifier.symbol,
    })
    return result
  }
}
