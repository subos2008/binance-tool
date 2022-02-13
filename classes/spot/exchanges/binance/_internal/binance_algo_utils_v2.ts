/* AlgoUtils but exchangeInfo is passed in explicitly */

import * as utils from "../../../../../lib/utils"
import { strict as assert } from "assert"

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}
import { Logger } from "../../../../../interfaces/logger"
import { TradingRules } from "../../../../../lib/trading_rules"
import Sentry from "../../../../../lib/sentry"
import {
  ExchangeInfo,
  NewOcoOrder,
  NewOrderSL,
  NewOrderSpot,
  OcoOrder,
  Order,
  OrderSide,
  OrderType,
} from "binance-api-node"
import { Binance as BinanceType } from "binance-api-node"

export class AlgoUtils {
  logger: Logger
  ee: BinanceType

  constructor({ logger, ee }: { logger: Logger; ee: BinanceType }) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
  }

  munge_and_check_price({
    exchange_info,
    symbol,
    price,
  }: {
    exchange_info: ExchangeInfo
    symbol: string
    price: BigNumber
  }) {
    return utils.munge_and_check_price({ exchange_info: exchange_info, symbol, price })
  }

  munge_amount_and_check_notionals({
    exchange_info,
    pair,
    base_amount,
    price,
    buy_price,
    stop_price,
    target_price,
    limit_price,
  }: {
    exchange_info: ExchangeInfo
    pair: string
    base_amount: BigNumber
    price?: BigNumber
    buy_price?: BigNumber
    stop_price?: BigNumber
    target_price?: BigNumber
    limit_price?: BigNumber
  }) {
    assert(exchange_info)
    assert(pair)
    assert(base_amount)
    base_amount = utils.munge_and_check_quantity({
      exchange_info,
      symbol: pair,
      volume: base_amount,
    })

    // generic
    if (typeof price !== "undefined") {
      utils.check_notional({
        price: price,
        volume: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof buy_price !== "undefined") {
      utils.check_notional({
        price: buy_price,
        volume: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof stop_price !== "undefined") {
      utils.check_notional({
        price: stop_price,
        volume: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof target_price !== "undefined") {
      utils.check_notional({
        price: target_price,
        volume: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof limit_price !== "undefined") {
      utils.check_notional({
        price: limit_price,
        volume: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    return base_amount
  }

  split_pair(pair: string): { quote_currency: string; base_currency: string } {
    const { base_coin: base_currency, quote_coin: quote_currency } = utils.break_up_binance_pair(pair)
    return {
      quote_currency,
      base_currency,
    }
  }

  calculate_percentages({
    buy_price,
    stop_price,
    target_price,
    trading_rules,
  }: {
    buy_price: BigNumber
    stop_price: BigNumber
    target_price: BigNumber
    trading_rules: TradingRules
  }) {
    let stop_percentage, target_percentage, max_portfolio_percentage_allowed_in_this_trade
    if (buy_price && stop_price) {
      assert(buy_price.isGreaterThan(0))
      stop_percentage = new BigNumber(buy_price).minus(stop_price).dividedBy(buy_price).times(100)
      assert(stop_percentage.isFinite())
      this.logger.info(`Stop percentage: ${stop_percentage.toFixed(2)}%`)
    }
    if (buy_price && target_price) {
      target_percentage = new BigNumber(target_price).minus(buy_price).dividedBy(buy_price).times(100)
      this.logger.info(`Target percentage: ${target_percentage.toFixed(2)}%`)
    }
    if (stop_percentage && target_percentage) {
      let risk_reward_ratio = target_percentage.dividedBy(stop_percentage)
      this.logger.info(`Risk/reward ratio: ${risk_reward_ratio.toFixed(1)}`)
    }
    if (stop_percentage && trading_rules && trading_rules.max_allowed_portfolio_loss_percentage_per_trade) {
      max_portfolio_percentage_allowed_in_this_trade = new BigNumber(
        trading_rules.max_allowed_portfolio_loss_percentage_per_trade
      )
        .dividedBy(stop_percentage)
        .times(100)
      this.logger.info(
        `Max portfolio allowed in trade: ${max_portfolio_percentage_allowed_in_this_trade.toFixed(1)}%`
      )
    }
    return max_portfolio_percentage_allowed_in_this_trade
  }

  async create_limit_buy_order({
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
    assert(pair && price && base_amount)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(price))
    try {
      base_amount = this.munge_amount_and_check_notionals({ exchange_info, pair, base_amount, price })
      let price_string = price.toFixed()
      let quantity = base_amount.toFixed()
      let args: NewOrderSpot = {
        useServerTime: true,
        symbol: pair,
        side: "BUY",
        type: OrderType.LIMIT,
        quantity,
        price: price_string,
        newClientOrderId: clientOrderId,
      }
      this.logger.info(`${pair} Creating LIMIT BUY ORDER for ${quantity} at ${price_string}`)
      let response = await this.ee.order(args)
      this.logger.info(`order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (error) {
      Sentry.captureException(error)
      throw error
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
    let munged_price = this.munge_and_check_price({ exchange_info, symbol: pair, price })
    let munged_base_amount = this.munge_amount_and_check_notionals({
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

  async create_limit_sell_order({
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
    assert(pair && price && base_amount)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(price))
    try {
      base_amount = this.munge_amount_and_check_notionals({ exchange_info, pair, base_amount, price })
      let quantity = base_amount.toFixed()
      let args: NewOrderSpot = {
        useServerTime: true,
        symbol: pair,
        side: "SELL",
        type: OrderType.LIMIT,
        quantity,
        price: price.toFixed(),
        newClientOrderId: clientOrderId,
      }
      this.logger.info(`${pair} Creating LIMIT SELL ORDER for ${quantity} at ${price.toFixed()}`)
      let response = await this.ee.order(args)
      this.logger.info(`order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (error: any) {
      console.error(`Buy error: ${error.body}`)
      console.error(error)
      Sentry.captureException(error)
      throw error
    }
  }

  // async munge_and_create_oco_order({
  //   exchange_info,
  //   pair,
  //   base_amount,
  //   target_price,
  //   stop_price,
  //   limit_price,
  //   clientOrderId,
  // }: {
  //   exchange_info: ExchangeInfo
  //   pair: string
  //   base_amount: BigNumber
  //   target_price: BigNumber
  //   stop_price: BigNumber
  //   limit_price: BigNumber
  //   clientOrderId: string
  // }) {
  //   assert(pair && target_price && base_amount && stop_price && limit_price)
  //   assert(BigNumber.isBigNumber(base_amount))
  //   assert(BigNumber.isBigNumber(target_price))
  //   assert(BigNumber.isBigNumber(limit_price))
  //   try {
  //     base_amount = this.munge_amount_and_check_notionals({
  //       exchange_info,
  //       pair,
  //       base_amount,
  //       stop_price,
  //       limit_price,
  //       target_price,
  //     })
  //     stop_price = this.munge_and_check_price({ exchange_info, symbol: pair, price: stop_price })
  //     limit_price = this.munge_and_check_price({ exchange_info, symbol: pair, price: limit_price })
  //     target_price = this.munge_and_check_price({ exchange_info, symbol: pair, price: target_price })
  //     let quantity = base_amount.toFixed()
  //     //   export interface NewOcoOrder {
  //     //     symbol: string;
  //     //     listClientOrderId?: string;
  //     //     side: OrderSide;
  //     //     quantity: string;
  //     //     limitClientOrderId?: string;
  //     //     price: string;
  //     //     limitIcebergQty?: string;
  //     //     stopClientOrderId?: string;
  //     //     stopPrice: string;
  //     //     stopLimitPrice?: string;
  //     //     stopIcebergQty?: string;
  //     //     stopLimitTimeInForce?: TimeInForce;
  //     //     newOrderRespType?: NewOrderRespType;
  //     //     recvWindow?: number;
  //     //     useServerTime?: boolean;
  //     // }
  //     let args: NewOcoOrder = {
  //       useServerTime: true,
  //       symbol: pair,
  //       side: "SELL" as OrderSide,
  //       quantity,
  //       price: target_price.toFixed(),
  //       stopPrice: stop_price.toFixed(),
  //       stopLimitPrice: limit_price.toFixed(),
  //       newClientOrderId: clientOrderId,
  //     }
  //     this.logger.info(
  //       `${pair} Creating OCO ORDER for ${quantity} at target ${target_price.toFixed()} stop triggered at ${stop_price.toFixed()}`
  //     )
  //     //   export interface OcoOrder {
  //     //     orderListId: number;
  //     //     contingencyType: ContingencyType;
  //     //     listStatusType: ListStatusType;
  //     //     listOrderStatus: ListOrderStatus;
  //     //     listClientOrderId: string;
  //     //     transactionTime: number;
  //     //     symbol: string;
  //     //     orders: Order[];
  //     //     orderReports: Order[];
  //     // }
  //     let response: OcoOrder = await this.ee.orderOco(args)
  //     return response
  //   } catch (error: any) {
  //     Sentry.captureException(error)
  //     async_error_handler(console, `Buy error: ${error.body}`, error)
  //   }
  // }

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
    assert(pair && stop_price && base_amount && stop_price && limit_price)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(stop_price))
    assert(BigNumber.isBigNumber(limit_price))
    if (stop_price.isEqualTo(limit_price)) {
      this.logger.warn(
        `WARNING: stop loss orders with limit and stop price the same will not fill in fast moving markets`
      )
    }
    if (limit_price.isEqualTo(0)) {
      this.logger.warn(`WARNING: stop loss orders with limit price of 0: munging not tested`)
    }
    this.logger.info(
      `Pre-munge: ${pair} Creating STOP_LOSS_LIMIT SELL ORDER for ${base_amount.toFixed()} at ${limit_price.toFixed()} triggered at ${stop_price.toFixed()}`
    )
    try {
      stop_price = this.munge_and_check_price({ exchange_info, symbol: pair, price: stop_price })
      limit_price = this.munge_and_check_price({ exchange_info, symbol: pair, price: limit_price })
      base_amount = this.munge_amount_and_check_notionals({ exchange_info, pair, base_amount, stop_price })
      let quantity = base_amount.toFixed()
      let args: NewOrderSpot = {
        useServerTime: true,
        symbol: pair,
        side: "SELL",
        type: OrderType.STOP_LOSS_LIMIT,
        quantity,
        price: limit_price.toFixed(),
        stopPrice: stop_price.toFixed(),
        newClientOrderId: clientOrderId,
      }
      this.logger.info(
        `${pair} Creating STOP_LOSS_LIMIT SELL ORDER for ${quantity} at ${limit_price.toFixed()} triggered at ${stop_price.toFixed()}`
      )
      let response = await this.ee.order(args)
      this.logger.info(`order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (error: any) {
      Sentry.captureException(error)
      this.logger.error(error)
      throw error
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
    assert(pair)
    assert(base_amount)
    assert(BigNumber.isBigNumber(base_amount))
    try {
      let quantity = base_amount.toFixed()
      let args: any = {
        useServerTime: true,
        side: "BUY",
        symbol: pair,
        type: "MARKET",
        quantity,
        newClientOrderId: clientOrderId,
      }
      this.logger.info(`Creating MARKET BUY ORDER for ${quantity} ${pair}`)
      let response = await this.ee.order(args)
      this.logger.info(`order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (error: any) {
      Sentry.captureException(error)
      console.error(`Market Buy error: ${error.body}`)
      console.error(error)
      throw error
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
    assert(pair)
    assert(quote_amount)
    assert(BigNumber.isBigNumber(quote_amount))
    try {
      let quoteOrderQty = quote_amount.toFixed()
      let args: any = {
        useServerTime: true,
        side: "BUY",
        symbol: pair,
        type: "MARKET",
        quoteOrderQty,
        newClientOrderId: clientOrderId,
      }
      this.logger.info(`Creating MARKET BUY ORDER for quoteOrderQty ${quoteOrderQty} ${pair}`)
      let response = await this.ee.order(args)
      this.logger.info(`order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (error: any) {
      Sentry.captureException(error)
      console.error(`Market buy error: ${error.body}`)
      console.error(error)
      throw error
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
    assert(pair)
    assert(base_amount)
    assert(BigNumber.isBigNumber(base_amount))
    try {
      let quantity = base_amount.toFixed()
      let args: any = {
        useServerTime: true,
        side: "SELL",
        symbol: pair,
        type: "MARKET",
        quantity,
        newClientOrderId: clientOrderId,
      }
      this.logger.info(`Creating MARKET SELL ORDER for ${quantity} ${pair}`)
      let response = await this.ee.order(args)
      this.logger.info(`order id: ${response.clientOrderId}`)
      assert.equal(response.clientOrderId, clientOrderId)
      return response
    } catch (error: any) {
      Sentry.captureException(error)
      console.error(`Market sell error: ${error.body}`)
      console.error(error)
      throw error
    }
  }

  async cancelOrder(args: { symbol: string; clientOrderId: string }) {
    return await this.ee.cancelOrder({ ...args, origClientOrderId: args.clientOrderId })
  }
}
