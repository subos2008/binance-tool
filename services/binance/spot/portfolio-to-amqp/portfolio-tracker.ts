import { strict as assert } from "assert"

import * as Sentry from "@sentry/node"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { HealthAndReadinessSubsystem } from "../../../../classes/health_and_readiness"
import { PortfolioUtils } from "../../../../classes/utils/portfolio-utils"
import { Logger } from "../../../../interfaces/logger"
import { Portfolio } from "../../../../interfaces/portfolio"
import { SendMessageFunc } from "../../../../lib/telegram-v2"
import { MasterPortfolioClass, PortfolioBitchClass } from "./interfaces"
import { PortfolioPublisher } from "./portfolio-publisher"
import { ExchangeIdentifier } from "../../../../events/shared/exchange-identifier"

// This class is a bit strange because it was originally intended to conglomerate multiple
// portfolio accounts into one view for publishing.
export class PortfolioTracker implements MasterPortfolioClass {
  send_message: SendMessageFunc
  logger: Logger
  ee: any
  portfolios: { [exchange: string]: Portfolio } = {}
  exchanges: { [exchange: string]: PortfolioBitchClass } = {}
  publisher: PortfolioPublisher
  portfolio_utils: PortfolioUtils
  health_and_readiness: HealthAndReadinessSubsystem

  constructor({
    send_message,
    logger,
    publisher,
    health_and_readiness,
  }: {
    send_message: SendMessageFunc
    logger: Logger
    publisher: PortfolioPublisher
    health_and_readiness: HealthAndReadinessSubsystem
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.publisher = publisher
    this.portfolio_utils = new PortfolioUtils({ logger, sentry: Sentry })
    this.health_and_readiness = health_and_readiness
    health_and_readiness.healthy(true)
    health_and_readiness.ready(true)
  }

  async set_portfolio_for_exchange({
    exchange_identifier,
    portfolio,
  }: {
    exchange_identifier: ExchangeIdentifier
    portfolio: Portfolio
  }) {
    // TODO: account not used in ExchangeIdentifier: default (default added so this appears in greps)
    this.portfolios[exchange_identifier.exchange] = portfolio
    this.report_current_portfolio() // this line is going to be a problem when we have multiple exchanges
  }

  async update_and_report_portfolio() {
    for await (const exchange of Object.values(this.exchanges)) {
      await exchange.update_portfolio_from_exchange()
    }
    await this.report_current_portfolio()
  }

  // this is called periodically or on orders and reports on the current portfolio
  async report_current_portfolio() {
    try {
      let portfolio = await this.collapse_and_decorate_exchange_balances()
      if (!portfolio) {
        this.logger.info(`no portfolio, skipping`)
        return
      }

      // This is just for the logfiles, we don't use this to send the event
      try {
        let msg = `B: ${portfolio.btc_value}, U: ${portfolio.usd_value}`
        try {
          msg += " as " + this.portfolio_utils.balances_to_string(portfolio, "BTC")
        } catch (err) {
          Sentry.captureException(err)
          this.logger.error({ err })
        }
        if (portfolio.prices) {
          try {
            msg += ` BTCUSDT: ${new BigNumber(portfolio.prices["BTCUSDT"]).dp(0).toFixed()}`
          } catch (e) {
            /* just ignore */
          }
        }
        this.logger.info(msg)
      } catch (err) {
        // Not fatal, we just used it for logging anyway
        Sentry.captureException(err)
        this.logger.error({ err })
      }

      await this.publisher.publish(portfolio)
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err })
    }
  }

  async collapse_and_decorate_exchange_balances() {
    if (!this.portfolios) {
      this.logger.warn(`No portfolios present in portfilio-tracker`)
      return
    }
    let exchanges: string[] = Object.keys(this.portfolios)
    if (exchanges.length > 1) throw new Error(`Multiple exchanges not implemented yet`)
    return this.decorate_portfolio(this.portfolios[exchanges[0]])
  }

  async decorate_portfolio(portfolio: Portfolio): Promise<Portfolio> {
    portfolio = this.portfolio_utils.add_quote_value_to_portfolio_balances({
      // TODO: convert to list
      portfolio,
      quote_currency: "BTC",
    }).portfolio
    portfolio = this.portfolio_utils.add_quote_value_to_portfolio_balances({
      portfolio,
      quote_currency: "USDT",
    }).portfolio
    portfolio.btc_value = this.portfolio_utils
      .calculate_portfolio_value_in_quote_currency({ quote_currency: "BTC", portfolio })
      .total // .dp(3)
      .toFixed()
    if (!portfolio.prices) throw new Error(`No prices`)
    portfolio.usd_value = this.portfolio_utils
      .calculate_portfolio_value_in_quote_currency({ quote_currency: "BUSD", portfolio })
      .total.dp(0)
      .toFixed()
    return portfolio
  }
}
