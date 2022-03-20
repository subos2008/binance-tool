#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { Portfolio, Balance, Prices } from "../../interfaces/portfolio"

let Sentry: any

export class PortfolioUtils {
  logger: Logger

  constructor({ logger, sentry }: { logger: Logger; sentry: any }) {
    assert(logger)
    this.logger = logger
    assert(sentry)
    Sentry = sentry
  }

  // Get value of one asset in terms of another ()
  // TODO: allow conversions backwards, i.e. USDT to BTC is done via the BTCUSDT pair
  convert_base_to_quote_currency({
    base_quantity,
    base_currency,
    quote_currency,
    prices,
  }: {
    base_quantity: BigNumber
    base_currency: string
    quote_currency: string
    prices: Prices
  }) {
    if (base_currency === quote_currency) return base_quantity
    let pair = `${base_currency}${quote_currency}`
    if (pair in prices) {
      return base_quantity.times(prices[pair])
    }

    let inverse_pair = `${quote_currency}${base_currency}`
    if (inverse_pair in prices) {
      return base_quantity.dividedBy(prices[inverse_pair])
    }

    throw new Error(`Pair ${pair} not available when converting ${base_currency} to ${quote_currency}`)
  }

  total_balance(balance: Balance) {
    let free = new BigNumber(balance.free)
    return free.plus(balance.locked).toFixed(8)
  }

  total_balance_bignum(balance: Balance) {
    return new BigNumber(balance.free).plus(balance.locked)
  }

  get_total_value_of_balance_in_quote_currency({
    balance,
    quote_currency,
    prices,
  }: {
    balance: Balance
    quote_currency: string
    prices: Prices
  }): BigNumber {
    let base_quantity = new BigNumber(balance.free).plus(balance.locked)
    if (balance.asset === quote_currency) {
      return base_quantity
    } else {
      return this.convert_base_to_quote_currency({
        base_quantity,
        base_currency: balance.asset,
        quote_currency,
        prices,
      })
    }
  }

  // free means not in orders
  get_free_balance_in_quote_currency({
    balance,
    quote_currency,
    prices,
  }: {
    balance: Balance
    quote_currency: string
    prices: Prices
  }): BigNumber {
    let base_quantity = new BigNumber(balance.free)
    if (balance.asset === quote_currency) {
      return base_quantity
    } else {
      return this.convert_base_to_quote_currency({
        base_quantity,
        base_currency: balance.asset,
        quote_currency,
        prices,
      })
    }
  }

  get_balances_with_free_greater_than({
    portfolio,
    quote_currency,
    quote_amount,
    prices,
  }: {
    portfolio: Portfolio
    quote_currency: string
    quote_amount: BigNumber
    prices: Prices
  }) {
    return portfolio.balances
      .map((p) => ({
        asset: p.asset,
        quote_amount: this.get_free_balance_in_quote_currency({ balance: p, quote_currency, prices }),
      }))
      .filter((p) => p.quote_amount.isGreaterThanOrEqualTo(quote_amount))
  }

  add_quote_value_to_portfolio_balances({
    portfolio,
    quote_currency,
  }: {
    portfolio: Portfolio
    quote_currency: string
  }): { portfolio: Portfolio; unprocessed_balances: string[] } {
    let unprocessed_balances: string[] = []
    if (!portfolio.balances) return { portfolio, unprocessed_balances } // NOP on stupid requests, could also throw
    if (!portfolio.prices)
      throw new Error("Cannot add_quote_value_to_portfolio_balances when portfolio has no prices")

    let processed_balances = portfolio.balances.map((balance: any) => {
      try {
        if (!portfolio.prices)
          throw new Error("Cannot add_quote_value_to_portfolio_balances when portfolio has no prices")
        let quote_value: BigNumber = this.get_total_value_of_balance_in_quote_currency({
          balance,
          quote_currency,
          prices: portfolio.prices,
        })
        let quote_equivalents = balance.quote_equivalents || {}
        quote_equivalents[quote_currency] = quote_value.toFixed(8)
        return Object.assign({}, balance, { quote_equivalents })
      } catch (e) {
        // Balances we were unable to convert
        unprocessed_balances.push(balance.asset)
        return balance
      }
    })
    if (unprocessed_balances.length)
      this.logger.warn(
        `Non fatal error: unable to convert ${unprocessed_balances.length} assets to ${quote_currency}, skipping`
      )
    return { portfolio: Object.assign({}, portfolio, { balances: processed_balances }), unprocessed_balances }
  }

  // TODO: Refactor to use add_quote_value_to_balances
  calculate_portfolio_value_in_quote_currency({
    quote_currency,
    portfolio,
  }: {
    quote_currency: string
    portfolio: Portfolio
  }): { total: BigNumber; unprocessed_balances: string[] } {
    try {
      let { portfolio: portfolio_with_quote_values, unprocessed_balances } =
        this.add_quote_value_to_portfolio_balances({ portfolio, quote_currency })
      if (!portfolio_with_quote_values.balances)
        throw new Error("Cannot calculate_portfolio_value_in_quote_currency when portfolio has no balances")
      if (!portfolio_with_quote_values.prices)
        throw new Error("Cannot calculate_portfolio_value_in_quote_currency when portfolio has no prices")
      let total = new BigNumber(0)
      for (const balance of portfolio_with_quote_values.balances) {
        total = total.plus(balance.quote_equivalents?.[quote_currency] || 0)
      }
      return { total, unprocessed_balances }
    } catch (error) {
      Sentry.captureException(error)
      throw error
    }
  }

  balances_to_string(portfolio: Portfolio, quote_currency: string): string | null {
    let quote_total = this.calculate_portfolio_value_in_quote_currency({ quote_currency, portfolio }).total
    let { portfolio: portfolio_with_quote_values } = this.add_quote_value_to_portfolio_balances({
      portfolio,
      quote_currency,
    })
    if (!portfolio_with_quote_values.balances) return null
    let balances = portfolio_with_quote_values.balances
      .filter((balance) => balance.quote_equivalents?.[quote_currency])
      .sort((a, b) =>
        new BigNumber(b.quote_equivalents?.[quote_currency] || 0)
          .minus(a.quote_equivalents?.[quote_currency] || 0)
          .toNumber()
      )
    let snippets: (string | null)[] = balances.map((balance) => {
      if (balance.asset == quote_currency) {
        let total = this.total_balance(balance)
        let percentage = new BigNumber(total).dividedBy(quote_total).times(100).toFixed(0)
        return `${quote_currency} (${percentage}%)`
        // return `${total}${quote_currency} (${percentage}%)`
      }
      if (!balance.quote_equivalents?.[quote_currency]) return null
      if (this.total_balance_bignum(balance).isZero()) return null
      let percentage = new BigNumber(balance.quote_equivalents[quote_currency]).dividedBy(quote_total).times(100)
      if (percentage.isLessThan(0.3)) return null
      return `${balance.asset} (${percentage.toFixed(0)}%)`
      // return `${balance.asset}: ${balance.quote_equivalents[quote_currency]}${quote_currency} (${percentage.toFixed(0)}%)`
    })
    // if (unprocessed_balances.length > 0) snippets.push(`${unprocessed_balances.length} unprocessed`)
    return snippets ? snippets.filter(Boolean).join(", ") : null
  }

  balance_for_asset({ asset, portfolio }: { asset: string; portfolio: Portfolio }) {
    return portfolio.balances?.find((balance) => balance.asset == asset)
  }
}
