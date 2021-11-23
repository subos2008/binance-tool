#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

// portfolio-publisher service:
//  Publishes the portfolio to AMQP:
//    1. on startup
//    2. monitoring the order streams and re-publishing on any changes
//    3. Periodically
//
// On changes:
//  1. Publishes to AMQP: portfolio with current price information
//
// Thoughts/TODO:
//  1. Could also check redis-trades matches position sizes
//  1. Doesn't currently re-publish on deposits/withdrawals

import { strict as assert } from "assert"

// Config
import { ExchangeIdentifier } from "../../events/shared/exchange-identifier"
const exchange_identifier: ExchangeIdentifier = { exchange: "binance", account: "default" }
const service_name = "binance-to-amqp"

import { MasterPortfolioClass, PortfolioBitchClass } from "./interfaces"

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

var service_is_healthy: boolean = true

const send_message = require("../../lib/telegram.js")(`${service_name}: `)

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const _logger: Logger = new LoggerClass({ silent: false })

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

process.on("unhandledRejection", (error) => {
  _logger.error(error)
  Sentry.captureException(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import { PortfolioPublisher } from "../../classes/amqp/portfolio-publisher"
import { PortfolioUtils } from "../../classes/utils/portfolio-utils"
import { Portfolio, Balance } from "../../interfaces/portfolio"
import { BinancePortfolioTracker } from "./portfolio"

const publisher = new PortfolioPublisher({ logger: _logger, send_message, exchange_identifier, event_name: 'SpotBinancePortfolio' })

class PortfolioTracker implements MasterPortfolioClass {
  send_message: Function
  logger: Logger
  ee: any
  portfolios: { [exchange: string]: Portfolio } = {}
  exchanges: { [exchange: string]: PortfolioBitchClass } = {}

  constructor({ send_message, logger }: { send_message: (msg: string) => void; logger: Logger }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
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
          msg += " as " + portfolio_utils.balances_to_string(portfolio, "BTC")
        } catch (err) {
          Sentry.captureException(err)
          this.logger.error(err)
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
        this.logger.error(err)
      }

      await publisher.publish(portfolio)
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error(err)
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
    portfolio = portfolio_utils.add_quote_value_to_portfolio_balances({
      // TODO: convert to list
      portfolio,
      quote_currency: "BTC",
    }).portfolio
    portfolio = portfolio_utils.add_quote_value_to_portfolio_balances({
      portfolio,
      quote_currency: "USDT",
    }).portfolio
    portfolio.btc_value = portfolio_utils
      .calculate_portfolio_value_in_quote_currency({ quote_currency: "BTC", portfolio })
      .total // .dp(3)
      .toFixed()
    if (!portfolio.prices) throw new Error(`No prices`)
    portfolio.usd_value = portfolio_utils
      .convert_base_to_quote_currency({
        base_quantity: new BigNumber(portfolio.btc_value),
        base_currency: "BTC",
        quote_currency: "USDT",
        prices: portfolio.prices,
      })
      // .dp(0)
      .toFixed()
    return portfolio
  }
}

let logger = _logger

const portfolio_utils: PortfolioUtils = new PortfolioUtils({ logger, sentry: Sentry })

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  let portfolio_tracker = new PortfolioTracker({ logger, send_message })
  let binance = new BinancePortfolioTracker({ send_message, logger, master: portfolio_tracker })

  // To function this service needs both of these, so go unhealthy if either fails
  try {
    await binance.start()
  } catch (error) {
    Sentry.captureException(error)
    logger.error(`Error connecting to exchange: ${error}`)
    logger.error(error)
    logger.error(`Error connecting to exchange: ${error.stack}`)
    soft_exit(1, `Error connecting to exchange: ${error}`)
    return
  }

  try {
    await publisher.connect()
  } catch (error) {
    Sentry.captureException(error)
    logger.error(`Error connecting to AMQP: ${error}`)
    logger.error(error)
    logger.error(`Error connecting to AMQP: ${error.stack}`)
    soft_exit(1, `Error connecting to AMQP: ${error}`)
    return
  }

  setInterval(portfolio_tracker.update_and_report_portfolio.bind(portfolio_tracker), 1000 * 60 * 60 * 6)
  await binance.update_portfolio_from_exchange() // automatically triggers report_current_portfolio
}

main().catch((error) => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`)
  logger.error(error)
  logger.error(`Error in main loop: ${error.stack}`)
  soft_exit(1, `Error in main loop: ${error}`)
})

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null, reason: string) {
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) process.exitCode = exit_code
  if (publisher) publisher.shutdown_streams()
  service_is_healthy = false // it seems service isn't exiting on soft exit, but add this to make sure
  Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

import * as express from "express"
var app = express()
app.get("/health", function (req, res) {
  if (service_is_healthy) res.send({ status: "OK" })
  else res.status(500).json({ status: "UNHEALTHY" })
})
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
