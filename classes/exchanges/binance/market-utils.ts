/* Exchange Neutral interface for operations on a given market
 * Where a market is a tradeable asset on an exchange - something you can create orders on and have positions in
 */

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Binance as BinanceType, Order, OcoOrder } from "binance-api-node"
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
import { get_limit_price_for_stop_order } from "../../specifications/default_limit_price_for_stop_orders"

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

  async market_symbol(): Promise<string> {
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
    //   export interface OcoOrder {
    //     orderListId: number;
    //     contingencyType: ContingencyType;
    //     listStatusType: ListStatusType;
    //     listOrderStatus: ListOrderStatus;
    //     listClientOrderId: string;
    //     transactionTime: number;
    //     symbol: string;
    //     orders: Order[];
    //     orderReports: Order[];
    // }
    let exchange_info = await this.exchange_info()
    let symbol = await this.market_symbol()
    let pair = symbol
    let munged_target_price = this.algo_utils.munge_and_check_price({
      exchange_info,
      symbol: pair,
      price: order_definition.target_price,
    })
    let munged_stop_price = this.algo_utils.munge_and_check_price({
      exchange_info,
      symbol: pair,
      price: order_definition.stop_price,
    })
    let munged_base_amount = this.algo_utils.munge_amount_and_check_notionals({
      exchange_info,
      pair: await this.market_symbol(),
      price: munged_stop_price,
      base_amount: order_definition.base_asset_quantity,
    })
    let limit_price =
      order_definition.limit_price || get_limit_price_for_stop_order({ stop_price: order_definition.stop_price })
    let munged_limit_price = this.algo_utils.munge_and_check_price({
      exchange_info,
      symbol: pair,
      price: limit_price,
    })
    let order: OcoOrder | undefined = await this.algo_utils.munge_and_create_oco_order({
      exchange_info,
      pair: await this.market_symbol(),
      target_price: munged_target_price,
      base_amount: munged_base_amount,
      stop_price: munged_stop_price,
      limit_price: munged_limit_price,
    })
    if (!order) throw new Error(`Failed to create OCO order on ${await this.base_asset()}`)
    // export type OCOSubOrder = {
    //   order_id: string
    //   symbol: string
    //   client_order_id: string
    // }

    // export type GenericOCOOrder = {
    //   order_transaction_timestamp: number,
    //   orders: OCOSubOrder[]
    // }

    // OcoOrder.orders entries only contain: symbol, orderId and clientOrderId
    this.logger.warn(`are OCO order SubOrder transaction quanitites always the same as the quantity passed in?`)
    this.logger.info(order.orders[0])
    this.logger.info(order.orders[1])
    return {
      order_transaction_timestamp: order.transactionTime,
      orders: order.orders.map((o) => ({
        order_id: o.orderId.toString(),
        client_order_id: o.clientOrderId,
      })),
      base_asset_quantity: munged_base_amount,
    }
  }

  async create_limit_sell_order(
    order_definition: GenericLimitSellOrderDefinition
  ): Promise<GenericLimitSellOrder> {
    let order: Order | undefined = await this.algo_utils.munge_and_create_limit_sell_order({
      exchange_info: await this.exchange_info(),
      pair: await this.market_symbol(),
      price: order_definition.limit_price,
      base_amount: order_definition.base_asset_quantity,
    })
    if (!order) throw new Error(`Failed to create_limit_sell_order`)
    return {
      limit_price: new BigNumber(order.price),
      order_id: order.orderId.toString(),
      base_asset_quantity: new BigNumber(order.origQty),
    }
  }

  async create_stop_limit_sell_order(
    order_definition: GenericStopLimitSellOrderDefinition
  ): Promise<GenericStopLimitSellOrder> {
    let limit_price =
      order_definition.limit_price || get_limit_price_for_stop_order({ stop_price: order_definition.stop_price })
    let order: Order | undefined = await this.algo_utils.munge_and_create_stop_loss_limit_sell_order({
      exchange_info: await this.exchange_info(),
      pair: await this.market_symbol(),
      limit_price,
      base_amount: order_definition.base_asset_quantity,
      stop_price: order_definition.stop_price,
    })
    if (!order) throw new Error(`Failed to create_stop_limit_sell_order`)
    return {
      limit_price: new BigNumber(limit_price),
      order_id: order.orderId.toString(),
      base_asset_quantity: order_definition.base_asset_quantity,
      stop_price: order_definition.stop_price,
    }
  }
}
