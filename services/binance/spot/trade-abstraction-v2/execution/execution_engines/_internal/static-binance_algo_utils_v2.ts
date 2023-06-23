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
} from "binance-api-node"
import { TooSmallToTrade } from "../../../../../../../interfaces/exchanges/generic/too_small_to_trade"
import { BinanceExchangeInfoGetter } from "../../../../../../../classes/exchanges/binance/exchange-info-getter"

export class StaticBinanceAlgoUtils {
  logger: ServiceLogger
  exchange_info_getter: BinanceExchangeInfoGetter

  constructor({
    logger,
    exchange_info_getter,
  }: {
    logger: ServiceLogger
    exchange_info_getter: BinanceExchangeInfoGetter
  }) {
    assert(logger)
    this.logger = logger
    this.exchange_info_getter = exchange_info_getter
  }

  static get_symbol_filters({ exchange_info, symbol }: { exchange_info: ExchangeInfo; symbol: string }) {
    let symbol_data = exchange_info.symbols.find((ei: any) => ei.symbol === symbol)
    if (!symbol_data) {
      // TODO: some kind of UnrecognisedPairError class?
      throw new Error(`Could not find exchange info for ${symbol}`)
    }
    return symbol_data.filters
  }

  static munge_and_check_quantity({
    exchange_info,
    symbol,
    volume,
  }: {
    exchange_info: ExchangeInfo
    symbol: string
    volume: BigNumber
  }) {
    assert(typeof volume !== "undefined")
    assert(exchange_info)
    assert(symbol)
    let filters = this.get_symbol_filters({ exchange_info, symbol })
    let ret: SymbolFilter | undefined = filters.find((eis: any) => eis.filterType === "LOT_SIZE") as
      | SymbolLotSizeFilter
      | undefined
    if (!ret) throw new Error(`Return undefined getting filter for LOT_SIZE`)
    const { stepSize, minQty } = ret
    volume = new BigNumber(utils.roundStep(new BigNumber(volume), stepSize))
    if (volume.isLessThan(minQty)) {
      throw new Error(`${volume} does not meet minimum quantity (LOT_SIZE): ${minQty}.`)
    }
    return volume
  }

  static munge_and_check_price({
    exchange_info,
    symbol,
    price,
  }: {
    exchange_info: ExchangeInfo
    symbol: string
    price: BigNumber
  }) {
    assert(typeof price !== "undefined")
    assert(exchange_info)
    assert(symbol)
    price = new BigNumber(price)
    if (price.isZero()) {
      return price // don't munge zero, special case for market buys
    }
    let filters = this.get_symbol_filters({ exchange_info, symbol })
    let ret = filters.find((eis: any) => eis.filterType === "PRICE_FILTER") as SymbolPriceFilter | undefined
    if (!ret) throw new Error(`Return undefined getting filter for LOT_SIZE`)
    const { tickSize, minPrice } = ret
    let tickSizeNumber = Number(tickSize)
    price = new BigNumber(utils.roundTicks(price, tickSizeNumber))
    if (price.isLessThan(minPrice)) {
      throw new Error(`${price} does not meet minimum order price (PRICE_FILTER): ${minPrice}.`)
    }
    return price
  }

  // Doesn't need to be private but probably not called directly
  static check_notional({
    price,
    volume,
    exchange_info,
    symbol,
  }: {
    exchange_info: ExchangeInfo
    symbol: string
    price: BigNumber
    volume: BigNumber
  }) {
    assert(typeof volume !== "undefined")
    assert(typeof price !== "undefined")
    assert(exchange_info)
    assert(symbol)
    price = new BigNumber(price)
    if (price.isZero()) {
      return price // don't munge zero, special case for market buys
    }
    let filters = this.get_symbol_filters({ exchange_info, symbol })
    let ret = filters.find((eis: any) => eis.filterType === "NOTIONAL") as SymbolMinNotionalFilter | undefined
    if (!ret) throw new Error(`Return undefined getting filter for NOTIONAL`)
    const { notional } = ret
    let quote_volume = price.times(volume)
    if (quote_volume.isLessThan(notional)) {
      throw new Error(
        `does not meet minimum order value ${notional} (NOTIONAL) (Buy of ${volume} at ${price} = ${quote_volume}).`
      )
    }
  }

  static munge_amount_and_check_notionals({
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
    base_amount = this.munge_and_check_quantity({
      exchange_info,
      symbol: pair,
      volume: base_amount,
    })

    // generic
    if (typeof price !== "undefined") {
      this.check_notional({
        price: price,
        volume: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof buy_price !== "undefined") {
      this.check_notional({
        price: buy_price,
        volume: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof stop_price !== "undefined") {
      this.check_notional({
        price: stop_price,
        volume: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof target_price !== "undefined") {
      this.check_notional({
        price: target_price,
        volume: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof limit_price !== "undefined") {
      this.check_notional({
        price: limit_price,
        volume: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    return base_amount
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
}
