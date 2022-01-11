const utils = require("../lib/utils_v2")
import { strict as assert } from "assert"
const async_error_handler = require("../lib/async_error_handler")

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}
import { Logger } from "../interfaces/logger"
import { TradingRules } from "../lib/trading_rules"
import * as Sentry from "@sentry/node"
import { Binance, OrderSide, OrderType } from "binance-api-node"

export class AlgoUtils {
  logger: Logger
  ee: Binance
  exchange_info: any

  constructor({ logger, ee }: { logger: Logger; ee: any }) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
  }

  set_exchange_info(exchange_info: any) {
    assert(exchange_info)
    this.exchange_info = exchange_info
  }

  munge_and_check_price({ symbol, price }: { symbol: string; price: BigNumber }) {
    return utils.munge_and_check_price({ exchange_info: this.exchange_info, symbol, price })
  }

  munge_amount_and_check_notionals({
    pair,
    base_amount,
    price,
    buy_price,
    stop_price,
    target_price,
    limit_price,
  }: {
    pair: string
    base_amount: BigNumber
    price?: BigNumber
    buy_price?: BigNumber
    stop_price?: BigNumber
    target_price?: BigNumber
    limit_price?: BigNumber
  }) {
    assert(this.exchange_info)
    assert(pair)
    assert(base_amount)
    base_amount = utils.munge_and_check_quantity({
      exchange_info: this.exchange_info,
      symbol: pair,
      volume: base_amount,
    })

    // generic
    if (typeof price !== "undefined") {
      utils.check_notional({
        price: price,
        volume: base_amount,
        exchange_info: this.exchange_info,
        symbol: pair,
      })
    }
    if (typeof buy_price !== "undefined") {
      utils.check_notional({
        price: buy_price,
        volume: base_amount,
        exchange_info: this.exchange_info,
        symbol: pair,
      })
    }
    if (typeof stop_price !== "undefined") {
      utils.check_notional({
        price: stop_price,
        volume: base_amount,
        exchange_info: this.exchange_info,
        symbol: pair,
      })
    }
    if (typeof target_price !== "undefined") {
      utils.check_notional({
        price: target_price,
        volume: base_amount,
        exchange_info: this.exchange_info,
        symbol: pair,
      })
    }
    if (typeof limit_price !== "undefined") {
      utils.check_notional({
        price: limit_price,
        volume: base_amount,
        exchange_info: this.exchange_info,
        symbol: pair,
      })
    }
    return base_amount
  }

  split_pair(pair: string): { quote_currency: string; base_currency: string } {
    const { base_currency, quote_currency } = utils.break_up_binance_pair(pair)
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
    pair,
    base_amount,
    price,
  }: {
    pair: string
    base_amount: BigNumber
    price: BigNumber
  }) {
    assert(pair && price && base_amount)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(price))
    try {
      base_amount = this.munge_amount_and_check_notionals({ pair, base_amount, price })
      let price_string = price.toFixed()
      let quantity = base_amount.toFixed()
      let args = {
        useServerTime: true,
        symbol: pair,
        side: "BUY" as OrderSide,
        type: "LIMIT" as OrderType,
        quantity,
        price: price_string,
      }
      this.logger.info(`${pair} Creating LIMIT BUY ORDER for ${quantity} at ${price_string}`)
      let response = await this.ee.order(args)
      this.logger.info(`order id: ${response.orderId}`)
      return response
    } catch (error) {
      Sentry.captureException(error)
      throw error
    }
  }

  // Just munge it and do it, for those times when you don't need to know the details
  async munge_and_create_limit_sell_order({
    pair,
    base_amount,
    price,
  }: {
    pair: string
    base_amount: BigNumber
    price: BigNumber
  }) {
    let munged_price = this.munge_and_check_price({ symbol: pair, price })
    let munged_base_amount = this.munge_amount_and_check_notionals({ pair, price: munged_price, base_amount })
    return this.create_limit_sell_order({ pair, base_amount: munged_base_amount, price: munged_price })
  }

  async create_limit_sell_order({
    pair,
    base_amount,
    price,
  }: {
    pair: string
    base_amount: BigNumber
    price: BigNumber
  }) {
    assert(pair && price && base_amount)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(price))
    try {
      base_amount = this.munge_amount_and_check_notionals({ pair, base_amount, price })
      let quantity = base_amount.toFixed()
      let args = {
        useServerTime: true,
        symbol: pair,
        side: "SELL" as OrderSide,
        type: "LIMIT" as OrderType,
        quantity,
        price: price.toFixed(),
      }
      this.logger.info(`${pair} Creating LIMIT SELL ORDER for ${quantity} at ${price.toFixed()}`)
      let response = await this.ee.order(args)
      this.logger.info(`order id: ${response.orderId}`)
      return response
    } catch (error: any) {
      async_error_handler(console, `Buy error: ${error.body}`, error)
    }
  }

  async create_stop_loss_limit_sell_order({
    pair,
    base_amount,
    price,
    stop_price,
  }: {
    pair: string
    base_amount: BigNumber
    price: BigNumber
    stop_price: BigNumber
  }) {
    assert(pair && price && base_amount && stop_price)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(price))
    if (stop_price.isEqualTo(price)) {
      this.logger.warn(
        `WARNING: stop loss orders with limit and stop price the same will not fill in fast moving markets`
      )
    }
    try {
      // TODO: not checking price because often it is zero
      base_amount = this.munge_amount_and_check_notionals({ pair, base_amount, stop_price })
      let quantity = base_amount.toFixed()
      let args = {
        useServerTime: true,
        symbol: pair,
        side: "SELL" as OrderSide,
        type: "STOP_LOSS_LIMIT" as OrderType,
        quantity,
        price: price.toFixed(),
        stopPrice: stop_price.toFixed(),
      }
      this.logger.info(
        `${pair} Creating STOP_LOSS_LIMIT SELL ORDER for ${quantity} at ${price.toFixed()} triggered at ${stop_price.toFixed()}`
      )
      let response = await this.ee.order(args)
      this.logger.info(`order id: ${response.orderId}`)
      return response
    } catch (error: any) {
      Sentry.captureException(error)
      async_error_handler(console, `Buy error: ${error.body}`, error)
    }
  }

  async create_market_buy_order({
    base_amount,
    pair,
    orderId,
  }: {
    base_amount: BigNumber
    pair: string
    orderId?: string | undefined
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
      }
      if (orderId) args.newClientOrderId = orderId
      this.logger.info(`Creating MARKET BUY ORDER for ${quantity} ${pair}`)
      let response = await this.ee.order(args)
      this.logger.info(`Exchange order id: ${response.orderId}, requested ${orderId}`)
      return response
    } catch (error: any) {
      Sentry.captureException(error)
      async_error_handler(console, `Market Buy error: ${error.body}`, error)
    }
  }

  async create_market_sell_order({
    base_amount,
    pair,
    orderId,
  }: {
    base_amount: BigNumber
    pair: string
    orderId: string | undefined
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
      }
      if (orderId) args.newClientOrderId = orderId
      this.logger.info(`Creating MARKET SELL ORDER for ${quantity} ${pair}`)
      let response = await this.ee.order(args)
      this.logger.info(`Exchange order id: ${response.orderId}, requested ${orderId}`)
      return response
    } catch (error: any) {
      Sentry.captureException(error)
      async_error_handler(console, `Market sell error: ${error.body}`, error)
    }
  }

  async cancelOrder(args: { symbol: string; orderId: number }) {
    await this.ee.cancelOrder(args)
  }
}
