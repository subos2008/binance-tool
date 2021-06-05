/* Exchange Neutral interface for operations on a given market
 * Where a market is a tradeable asset on an exchange - something you can create orders on and have positions in
 */

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Binance as BinanceType, OcoOrder, Order } from "binance-api-node"
import Binance from "binance-api-node"
import { ExchangeIdentifier } from "../../../events/shared/exchange-identifier"
import {
  GenericOCOOderDefinition,
  GenericOCOOrder,
  GenericLimitSellOrderDefinition,
  GenericLimitSellOrder,
  GenericStopLimitSellOrderDefinition,
  GenericStopLimitSellOrder,
  MarketUtils,
} from "../../../interfaces/exchange/generic/market-utils"
import { Logger } from "../../../interfaces/logger"
import { AlgoUtils } from "../../../service_lib/binance_algo_utils_v2"
import { MarketIdentifier } from "../../../events/shared/market-identifier"

export class BinanceMarketUtils implements MarketUtils {
  ee: BinanceType
  logger: Logger
  algo_utils: AlgoUtils
  exchange_identifier: ExchangeIdentifier
  _base_asset: string
  _quote_asset: string
  _exchange_info: any

  constructor({ logger, market_identifier }: { logger: Logger; market_identifier: MarketIdentifier }) {
    this.logger = logger
    this.exchange_identifier = market_identifier.exchange_identifier
    this._base_asset = market_identifier.base_asset
    this._quote_asset = market_identifier.quote_asset
    if (!process.env.APIKEY) throw new Error(`APIKEY not defined`)
    if (!process.env.APISECRET) throw new Error(`APISECRET not defined`)
    logger.warn(`ee derived from env vars and not ExchangeIdentifier`)
    this.ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET,
    })
    this.algo_utils = new AlgoUtils({ logger: this.logger, ee: this.ee })
  }

  async base_asset() {
    return this._base_asset
  }

  async quote_asset() {
    return this._quote_asset
  }

  get _binance_symbol(): string {
    return `${this._base_asset.toUpperCase()}${this._quote_asset.toUpperCase()}`
  }

  async exchange_info() {
    if (this._exchange_info) return this._exchange_info
    else {
      // TODO: expiration
      return (this._exchange_info = await this.ee.exchangeInfo())
    }
  }

  async create_oco_order(order_definition: GenericOCOOderDefinition): Promise<GenericOCOOrder> {
    await this.algo_utils.munge_and_create_oco_order({
      exchange_info: await this.exchange_info(),
      pair: this._binance_symbol,
      target_price: order_definition.target_price,
      base_amount: order_definition.base_asset_quantity,
      stop_price: order_definition.stop_price
    })
    return {
    }
  }

  async create_limit_sell_order(
    order_definition: GenericLimitSellOrderDefinition
  ): Promise<GenericLimitSellOrder> {
    let order: Order = await this.algo_utils.munge_and_create_limit_sell_order({
      exchange_info: await this.exchange_info(),
      pair: this._binance_symbol,
      price: order_definition.limit_price,
      base_amount: order_definition.base_asset_quantity,
    })
    return {
      limit_price: new BigNumber(order.price),
      order_id: order.orderId.toString(),
      base_asset_quantity: new BigNumber(order.origQty),
    }
  }

  // async create_oco_order(order_definition:GenericOCOOderDefinition) :Promise<GenericOCOOrder> {

  // }

  async create_stop_limit_sell_order(
    order_definition: GenericStopLimitSellOrderDefinition
  ): Promise<GenericStopLimitSellOrder> {
    let order: Order = await this.algo_utils.create_stop_loss_limit_sell_order({
      exchange_info: await this.exchange_info(),
      pair: this._binance_symbol,
      price: order_definition.limit_price,
      base_amount: order_definition.base_asset_quantity,
      stop_price: order_definition.stop_price,
    })
    return {
      limit_price: new BigNumber(order.price),
      order_id: order.orderId.toString(),
      base_asset_quantity: new BigNumber(order.origQty),
      stop_price: new BigNumber(order.stopPrice as string),
    }
  }
}
