/* AlgoUtils but exchangeInfo is passed in explicitly */

import * as utils from "../../../../../../../lib/utils"
import { strict as assert } from "assert"

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}
import { ServiceLogger } from "../../../../../../../interfaces/logger"
import { TradingRules } from "../../../../../../../lib/trading_rules"
import Sentry from "../../../../../../../lib/sentry"
import {
  ExchangeInfo,
  NewOcoOrder,
  NewOrderSL,
  NewOrderSpot,
  OcoOrder,
  Order,
  OrderSide,
  OrderType,
  SymbolFilter,
  SymbolLotSizeFilter,
  SymbolMinNotionalFilter,
  SymbolPriceFilter,
  TimeInForce_LT,
} from "binance-api-node"
import { Binance as BinanceType } from "binance-api-node"
import { TooSmallToTrade } from "../../../../../../../interfaces/exchanges/generic/too_small_to_trade"
import { BinanceExchangeInfoGetter } from "../../../../../../../classes/exchanges/binance/exchange-info-getter"
import { StaticBinanceAlgoUtils } from "./static-binance_algo_utils_v2"

export class BinanceAlgoUtils implements TooSmallToTrade {
  logger: ServiceLogger
  ee: BinanceType
  exchange_info_getter: BinanceExchangeInfoGetter

  constructor({
    logger,
    ee,
    exchange_info_getter,
  }: {
    logger: ServiceLogger
    ee: BinanceType
    exchange_info_getter?: BinanceExchangeInfoGetter
  }) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
    this.exchange_info_getter = exchange_info_getter ? exchange_info_getter : new BinanceExchangeInfoGetter({ ee })
  }

  async is_too_small_to_trade({
    price,
    volume,
    exchange_info_getter,
    symbol,
  }: {
    exchange_info_getter: BinanceExchangeInfoGetter
    symbol: string
    price: BigNumber
    volume: BigNumber
  }): Promise<boolean> {
    let exchange_info = await exchange_info_getter.get_exchange_info()
    try {
      StaticBinanceAlgoUtils.check_notional({
        exchange_info,
        symbol,
        price: StaticBinanceAlgoUtils.munge_and_check_price({ exchange_info, symbol, price }),
        volume: StaticBinanceAlgoUtils.munge_and_check_quantity({ exchange_info, symbol, volume }),
      })
    } catch (e) {
      return true
    }
    return false
  }

  private get_symbol_filters({ exchange_info, symbol }: { exchange_info: ExchangeInfo; symbol: string }) {
    let symbol_data = exchange_info.symbols.find((ei: any) => ei.symbol === symbol)
    if (!symbol_data) {
      // TODO: some kind of UnrecognisedPairError class?
      throw new Error(`Could not find exchange info for ${symbol}`)
    }
    return symbol_data.filters
  }

  async create_limit_buy_order({
    exchange_info,
    pair,
    base_amount,
    price,
    clientOrderId,
    timeInForce,
  }: {
    exchange_info: ExchangeInfo
    pair: string
    base_amount: BigNumber
    price: BigNumber
    clientOrderId: string
    timeInForce?: TimeInForce_LT
  }) {
    let tags = { symbol: pair }

    assert(pair && price && base_amount)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(price))
    try {
      price = StaticBinanceAlgoUtils.munge_and_check_price({ exchange_info, symbol: pair, price })
      base_amount = StaticBinanceAlgoUtils.munge_amount_and_check_notionals({
        exchange_info,
        pair,
        base_amount,
        price,
      })
      let price_string = price.toFixed()
      let quantity = base_amount.toFixed()
      let args: NewOrderSpot = {
        // useServerTime: true,
        symbol: pair,
        side: "BUY",
        type: OrderType.LIMIT,
        quantity,
        price: price_string,
        newClientOrderId: clientOrderId,
        timeInForce,
        newOrderRespType: "RESULT",
      }
      this.logger.info(tags, `${pair} Creating LIMIT BUY ORDER for ${quantity} at ${price_string}`)
      let response = await this.ee.order(args)
      this.logger.info(tags, JSON.stringify({ ...response, object_type: "BinanceOrder" }))
      this.logger.info(tags, `order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (err) {
      this.logger.exception(tags, err)
      throw err
    }
  }

  // Just munge it and do it, for those times when you don't need to know the details
  async munge_and_create_limit_sell_order({
    exchange_info,
    pair,
    base_amount,
    price,
    clientOrderId,
  }: {
    exchange_info: ExchangeInfo
    pair: string
    base_amount: BigNumber
    price: BigNumber
    clientOrderId: string
  }) {
    let munged_price = StaticBinanceAlgoUtils.munge_and_check_price({ exchange_info, symbol: pair, price })
    let munged_base_amount = StaticBinanceAlgoUtils.munge_amount_and_check_notionals({
      exchange_info,
      pair,
      price: munged_price,
      base_amount,
    })
    return this.create_limit_sell_order({
      exchange_info,
      pair,
      base_amount: munged_base_amount,
      price: munged_price,
      clientOrderId,
    })
  }

  private async create_limit_sell_order({
    exchange_info,
    pair,
    base_amount,
    price,
    clientOrderId,
  }: {
    exchange_info: ExchangeInfo
    pair: string
    base_amount: BigNumber
    price: BigNumber
    clientOrderId: string
  }) {
    let tags = { symbol: pair }
    assert(pair && price && base_amount)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(price))
    try {
      base_amount = StaticBinanceAlgoUtils.munge_amount_and_check_notionals({
        exchange_info,
        pair,
        base_amount,
        price,
      })
      let quantity = base_amount.toFixed()
      let args: NewOrderSpot = {
        // useServerTime: true,
        symbol: pair,
        side: "SELL",
        type: OrderType.LIMIT,
        quantity,
        price: price.toFixed(),
        newClientOrderId: clientOrderId,
      }
      this.logger.info(tags, `${pair} Creating LIMIT SELL ORDER for ${quantity} at ${price.toFixed()}`)
      let response = await this.ee.order(args)
      this.logger.info(tags, `order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (err: any) {
      console.error(`Sell error: ${err.body}`)
      this.logger.exception(tags, err)
      throw err
    }
  }

  async munge_and_create_oco_order({
    exchange_info,
    pair,
    base_amount,
    target_price,
    stop_price,
    limit_price,
    stop_ClientOrderId,
    take_profit_ClientOrderId,
    oco_list_ClientOrderId,
  }: {
    exchange_info: ExchangeInfo
    pair: string
    base_amount: BigNumber
    target_price: BigNumber
    stop_price: BigNumber
    limit_price: BigNumber
    stop_ClientOrderId: string
    take_profit_ClientOrderId: string
    oco_list_ClientOrderId: string
  }) {
    let tags = { symbol: pair }
    assert(pair && target_price && base_amount && stop_price && limit_price)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(target_price))
    assert(BigNumber.isBigNumber(limit_price))
    try {
      base_amount = StaticBinanceAlgoUtils.munge_amount_and_check_notionals({
        exchange_info,
        pair,
        base_amount,
        stop_price,
        limit_price,
        target_price,
      })
      stop_price = StaticBinanceAlgoUtils.munge_and_check_price({ exchange_info, symbol: pair, price: stop_price })
      limit_price = StaticBinanceAlgoUtils.munge_and_check_price({
        exchange_info,
        symbol: pair,
        price: limit_price,
      })
      target_price = StaticBinanceAlgoUtils.munge_and_check_price({
        exchange_info,
        symbol: pair,
        price: target_price,
      })
      let quantity = base_amount.toFixed()
      //   export interface NewOcoOrder {
      //     symbol: string;
      //     listClientOrderId?: string;
      //     side: OrderSide;
      //     quantity: string;
      //     limitClientOrderId?: string;
      //     price: string;
      //     limitIcebergQty?: string;
      //     stopClientOrderId?: string;
      //     stopPrice: string;
      //     stopLimitPrice?: string;
      //     stopIcebergQty?: string;
      //     stopLimitTimeInForce?: TimeInForce;
      //     newOrderRespType?: NewOrderRespType;
      //     recvWindow?: number;
      //     useServerTime?: boolean;
      // }
      let args: NewOcoOrder = {
        // useServerTime: true,
        symbol: pair,
        side: "SELL" as OrderSide,
        quantity,
        price: target_price.toFixed(),
        stopPrice: stop_price.toFixed(),
        stopLimitPrice: limit_price.toFixed(),
        listClientOrderId: oco_list_ClientOrderId,
        limitClientOrderId: take_profit_ClientOrderId,
        stopClientOrderId: stop_ClientOrderId,
      }
      this.logger.info(
        tags,
        `${pair} Creating OCO ORDER for ${quantity} at target ${target_price.toFixed()} stop triggered at ${stop_price.toFixed()}`
      )
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
      let response: OcoOrder = await this.ee.orderOco(args)
      return response
    } catch (err: any) {
      let context = { symbol: pair, class: "AlgoUtils", method: "munge_and_create_oco_order" }
      Sentry.captureException(err, {
        tags: context,
      })
      this.logger.exception(tags, err)
      this.logger.error(context, `OCO error: ${err.body}`)
      throw err
    }
  }

  async munge_and_create_stop_loss_limit_sell_order({
    exchange_info,
    pair,
    base_amount,
    stop_price,
    limit_price,
    clientOrderId,
  }: {
    exchange_info: ExchangeInfo
    pair: string
    base_amount: BigNumber
    stop_price: BigNumber
    limit_price: BigNumber
    clientOrderId: string
  }): Promise<Order> {
    let tags = { symbol: pair }
    assert(pair && stop_price && base_amount && stop_price && limit_price)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(stop_price))
    assert(BigNumber.isBigNumber(limit_price))
    if (stop_price.isEqualTo(limit_price)) {
      this.logger.warn(
        tags,
        `WARNING: stop loss orders with limit and stop price the same will not fill in fast moving markets`
      )
    }
    if (limit_price.isEqualTo(0)) {
      this.logger.warn(tags, `WARNING: stop loss orders with limit price of 0: munging not tested`)
    }
    this.logger.info(
      tags,
      `Pre-munge: ${pair} Creating STOP_LOSS_LIMIT SELL ORDER for ${base_amount.toFixed()} at ${limit_price.toFixed()} triggered at ${stop_price.toFixed()}`
    )
    try {
      stop_price = StaticBinanceAlgoUtils.munge_and_check_price({ exchange_info, symbol: pair, price: stop_price })
      limit_price = StaticBinanceAlgoUtils.munge_and_check_price({
        exchange_info,
        symbol: pair,
        price: limit_price,
      })
      base_amount = StaticBinanceAlgoUtils.munge_amount_and_check_notionals({
        exchange_info,
        pair,
        base_amount,
        stop_price,
      })
      let quantity = base_amount.toFixed()
      let args: NewOrderSpot = {
        // useServerTime: true,
        symbol: pair,
        side: "SELL",
        type: OrderType.STOP_LOSS_LIMIT,
        quantity,
        price: limit_price.toFixed(),
        stopPrice: stop_price.toFixed(),
        newClientOrderId: clientOrderId,
      }
      this.logger.info(
        tags,
        `${pair} Creating STOP_LOSS_LIMIT SELL ORDER for ${quantity} at ${limit_price.toFixed()} triggered at ${stop_price.toFixed()}`
      )
      let response = await this.ee.order(args)
      this.logger.info(tags, `order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (err: any) {
      this.logger.exception(tags, err)
      throw err
    }
  }

  async create_market_buy_order({
    base_amount,
    pair,
    clientOrderId,
  }: {
    base_amount: BigNumber
    pair: string
    clientOrderId: string
  }) {
    let tags = { symbol: pair }
    assert(pair)
    assert(base_amount)
    assert(BigNumber.isBigNumber(base_amount))
    try {
      let quantity = base_amount.toFixed()
      let args: any = {
        // useServerTime: true,
        side: "BUY",
        symbol: pair,
        type: "MARKET",
        quantity,
        newClientOrderId: clientOrderId,
      }
      this.logger.info(tags, `Creating MARKET BUY ORDER for ${quantity} ${pair}`)
      let response = await this.ee.order(args)
      this.logger.info(tags, `order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (err: any) {
      this.logger.exception(tags, err)
      console.error(`MARKET BUY error: ${err.body}`) // .body? Really?
      throw err
    }
  }

  async create_market_buy_order_by_quote_amount({
    quote_amount,
    pair,
    clientOrderId,
  }: {
    quote_amount: BigNumber
    pair: string
    clientOrderId: string
  }) {
    let tags = { symbol: pair }
    assert(pair)
    assert(quote_amount)
    assert(BigNumber.isBigNumber(quote_amount))
    try {
      let quoteOrderQty = quote_amount.toFixed()
      let args: any = {
        // useServerTime: true,
        side: "BUY",
        symbol: pair,
        type: "MARKET",
        quoteOrderQty,
        newClientOrderId: clientOrderId,
      }
      this.logger.info(tags, `Creating MARKET BUY ORDER for quoteOrderQty ${quoteOrderQty} ${pair}`)
      let response = await this.ee.order(args)
      this.logger.info(tags, `order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (err: any) {
      this.logger.exception(tags, err)
      console.error(`MARKET BUY error: ${err.body}`) // .body? Really?
      throw err
    }
  }

  async create_market_sell_order({
    base_amount,
    pair,
    clientOrderId,
  }: {
    base_amount: BigNumber
    pair: string
    clientOrderId: string
  }) {
    let tags = { symbol: pair }
    assert(pair)
    assert(base_amount)
    assert(BigNumber.isBigNumber(base_amount))
    try {
      let quantity = base_amount.toFixed()
      let args: NewOrderSpot = {
        // useServerTime: true,
        side: "SELL",
        symbol: pair,
        type: OrderType.MARKET,
        quantity,
        newClientOrderId: clientOrderId,
        newOrderRespType: "RESULT",
      }
      this.logger.info(tags, `Creating MARKET SELL ORDER for ${quantity} ${pair}`)
      let response = await this.ee.order(args)
      this.logger.info(tags, `order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (err: any) {
      this.logger.exception(tags, err)
      console.error(`MARKET SELL error: ${err.body}`) // .body? Really?
      throw err
    }
  }

  async cancelOrder(args: { symbol: string; clientOrderId: string }) {
    return await this.ee.cancelOrder({ ...args, origClientOrderId: args.clientOrderId })
  }
}
