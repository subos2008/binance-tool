import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import Sentry from "../../../../../../lib/sentry"
// import { Logger } from "../../../../../../interfaces/logger"
import { strict as assert } from "assert"
import { Binance, ExchangeInfo } from "binance-api-node"

export class BinanceMunger {
  private roundStep(qty: BigNumber, stepSize: string) {
    // Integers do not require rounding
    if (Number.isInteger(qty.toNumber())) return qty
    const qtyString = qty.toFixed(16)
    const desiredDecimals = Math.max(stepSize.indexOf("1") - 1, 0)
    const decimalIndex = qtyString.indexOf(".")
    return new BigNumber(qtyString.slice(0, decimalIndex + desiredDecimals + 1))
  }

  get_symbol_filters({ exchange_info, symbol }: { exchange_info: any; symbol: string }) {
    // TODO: argh omg this is disgusting hardcoding of the default_pair
    let symbol_data = exchange_info.symbols.find((ei: any) => ei.symbol === symbol)
    if (!symbol_data) {
      // TODO: some kind of UnrecognisedPairError class?
      throw new Error(`Could not find exchange info for ${symbol}`)
    }
    return symbol_data.filters
  }

  check_notional({
    price,
    quantity,
    exchange_info,
    symbol,
  }: {
    exchange_info: any
    symbol: string
    price: BigNumber
    quantity: BigNumber
  }) {
    assert(typeof quantity !== "undefined")
    assert(typeof price !== "undefined")
    assert(exchange_info)
    assert(symbol)
    price = new BigNumber(price)
    if (price.isZero()) {
      return price // don't munge zero, special case for market buys
    }
    let filters = this.get_symbol_filters({ exchange_info, symbol })
    const { minNotional } = filters.find((eis: any) => eis.filterType === "MIN_NOTIONAL")
    let quote_volume = price.times(quantity)
    if (quote_volume.isLessThan(minNotional)) {
      throw new Error(
        `does not meet minimum order value ${minNotional} (MIN_NOTIONAL) (Buy of ${quantity} at ${price} = ${quote_volume}).`
      )
    }
  }

  private roundTicks(price: BigNumber, tickSize: number) {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "decimal",
      minimumFractionDigits: 0,
      maximumFractionDigits: 8,
    })
    // . not present for tickSize on some markets (i.e. 1 for MKRBUSD)
    let precision: number
    try {
      precision = formatter.format(tickSize).split(".")?.[1]?.length || 0
    } catch (e) {
      precision = 0
    }
    if (typeof price === "string") price = new BigNumber(price)
    return price.toFixed(precision)
  }

  munge_and_check_price({
    exchange_info,
    symbol,
    price,
  }: {
    exchange_info: any
    symbol: string
    price: BigNumber
  }): BigNumber {
    assert(typeof price !== "undefined")
    assert(exchange_info)
    assert(symbol)
    price = new BigNumber(price)
    if (price.isZero()) {
      return price // don't munge zero, special case for market buys
    }
    let filters = this.get_symbol_filters({ exchange_info, symbol })
    const { tickSize, minPrice } = filters.find((eis: any) => eis.filterType === "PRICE_FILTER")
    price = new BigNumber(this.roundTicks(price, tickSize))
    if (price.isLessThan(minPrice)) {
      throw new Error(`${price} does not meet minimum order price (PRICE_FILTER): ${minPrice}.`)
    }
    return price
  }

  munge_and_check_quantity({
    exchange_info,
    symbol,
    quantity,
  }: {
    exchange_info: any
    symbol: string
    quantity: BigNumber
  }): BigNumber {
    assert(typeof quantity !== "undefined")
    assert(exchange_info)
    assert(symbol)
    let filters = this.get_symbol_filters({ exchange_info, symbol })
    const { stepSize, minQty } = filters.find((eis: any) => eis.filterType === "LOT_SIZE")
    quantity = new BigNumber(this.roundStep(new BigNumber(quantity), stepSize))
    if (quantity.isLessThan(minQty)) {
      throw new Error(`${quantity} does not meet minimum quantity (LOT_SIZE): ${minQty}.`)
    }
    return quantity
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
    base_amount = this.munge_and_check_quantity({
      exchange_info,
      symbol: pair,
      quantity: base_amount,
    })

    // generic
    if (typeof price !== "undefined") {
      this.check_notional({
        price: price,
        quantity: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof buy_price !== "undefined") {
      this.check_notional({
        price: buy_price,
        quantity: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof stop_price !== "undefined") {
      this.check_notional({
        price: stop_price,
        quantity: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof target_price !== "undefined") {
      this.check_notional({
        price: target_price,
        quantity: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    if (typeof limit_price !== "undefined") {
      this.check_notional({
        price: limit_price,
        quantity: base_amount,
        exchange_info,
        symbol: pair,
      })
    }
    return base_amount
  }
}
