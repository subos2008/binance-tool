#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

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
//  1. Doesn't currently re-publish on deposits/withdrawals

// Config
const service_name = "binance-portfolio-to-amqp"
const quote_currency = "BUSD"

import { strict as assert } from "assert"

require("dotenv").config()

import Sentry from "../../../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

const exchange_identifier: ExchangeIdentifier_V3 = {
  type: "spot",
  version: "v3",
  exchange: "binance",
  account: "default",
}

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { SendMessage } from "../../../../classes/send_message/publish"
import { OrderExecutionTracker } from "../orders-to-amqp/spot-order-execution-tracker"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { SpotPortfolio } from "../../../../interfaces/portfolio"
import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { BinanceOrderData } from "../../../../interfaces/exchanges/binance/order_callbacks"
import { PortfolioPublisher } from "./portfolio-publisher"
import express from "express"
import { SendMessageFunc } from "../../../../interfaces/send-message"
import { PortfolioSnapshot } from "../../../../classes/utils/portfolio-snapshot"
import { ServiceLogger } from "../../../../interfaces/logger"
import { BinanceExchangeInfoGetter } from "../../../../classes/exchanges/binance/exchange-info-getter"
import { BunyanServiceLogger } from "../../../../lib/service-logger"
import { CurrentAllPricesGetter } from "../../../../interfaces/exchanges/generic/price-getter"
import { BinancePriceGetter } from "../../../../interfaces/exchanges/binance/binance-price-getter"
import { SpotPortfolioUtils } from "../../../../classes/utils/spot-portfolio-utils"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_type: "ServiceStarting", msg: "Service starting" })

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
const service_is_healthy = health_and_readiness.addSubsystem({
  name: "global",
  healthy: true,
  initialised: true,
})

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
  service_is_healthy.healthy(false)
})

export class BinancePortfolioToAMQP {
  send_message: SendMessageFunc
  logger: ServiceLogger
  order_execution_tracker: OrderExecutionTracker
  exchange_identifier: ExchangeIdentifier_V3
  publisher: PortfolioPublisher
  health_and_readiness: HealthAndReadiness
  portfolio_snapshot: PortfolioSnapshot
  price_getter: CurrentAllPricesGetter
  portfolio_utils: SpotPortfolioUtils

  constructor({
    send_message,
    logger,
    health_and_readiness,
  }: {
    send_message: SendMessageFunc
    logger: ServiceLogger
    health_and_readiness: HealthAndReadiness
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)

    this.health_and_readiness = health_and_readiness

    this.exchange_identifier = { exchange: "binance", account: "default", type: "spot", version: "v3" }

    this.portfolio_utils = new SpotPortfolioUtils({ logger })

    this.publisher = new PortfolioPublisher({
      logger,
      event_name: "SpotPortfolio",
      health_and_readiness,
      exchange_identifier: this.exchange_identifier,
    })

    this.send_message = send_message
    if (!process.env.BINANCE_API_KEY) throw new Error(`Missing BINANCE_API_KEY in ENV`)
    if (!process.env.BINANCE_API_SECRET) throw new Error(`Missing BINANCE_API_SECRET in ENV`)
    let ee: BinanceType = Binance({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
    })

    let exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
    this.portfolio_snapshot = new PortfolioSnapshot({
      logger,
      exchange_info_getter,
    })

    this.price_getter = new BinancePriceGetter({ logger, ee, cache_timeout_ms: 1000 * 60 * 10 })

    this.order_execution_tracker = new OrderExecutionTracker({
      ee,
      send_message,
      logger,
      order_callbacks: this,
      exchange_identifier,
    })
  }

  async start() {
    try {
      await this.publisher.connect()
    } catch (err: any) {
      this.logger.error(`Error connecting to AMQP: ${err}`)
      return
    }

    setInterval(this.update_portfolio_from_exchange.bind(this), 1000 * 60 * 60 * 6)
    await this.update_portfolio_from_exchange()

    this.order_execution_tracker.main()
  }

  async update_portfolio_from_exchange() {
    let portfolio: SpotPortfolio = {
      object_type: "SpotPortfolio",
      version: 1,
      timestamp_ms: Date.now(),
      exchange_identifier: this.exchange_identifier,
      prices: await this.get_prices_from_exchange(),
      balances: await this.portfolio_snapshot.take_snapshot(),
    }

    await this.report_portfolio(portfolio)
  }

  async order_filled(data: BinanceOrderData): Promise<void> {
    this.logger.info(`Binance: ${data.side} order on ${data.symbol} filled.`)
    await this.update_portfolio_from_exchange()
  }

  async get_prices_from_exchange() {
    try {
      return await this.price_getter.prices()
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  }

  async report_portfolio(_portfolio: SpotPortfolio) {
    try {
      let portfolio = await this.decorate_portfolio(_portfolio, quote_currency)
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

  async decorate_portfolio(portfolio: SpotPortfolio, quote_currency: string): Promise<SpotPortfolio> {
    portfolio = this.portfolio_utils.add_quote_value_to_portfolio_balances({
      // TODO: convert to list
      portfolio,
      quote_currency: "BTC",
    }).portfolio
    portfolio = this.portfolio_utils.add_quote_value_to_portfolio_balances({
      portfolio,
      quote_currency,
    }).portfolio
    portfolio.btc_value = this.portfolio_utils
      .calculate_portfolio_value_in_quote_currency({ quote_currency: "BTC", portfolio })
      .total // .dp(3)
      .toFixed()
    if (!portfolio.prices) throw new Error(`No prices`)
    portfolio.usd_value = this.portfolio_utils
      .calculate_portfolio_value_in_quote_currency({ quote_currency, portfolio })
      .total.dp(0)
      .toFixed()
    return portfolio
  }
}

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  try {
    let portfolio_to_amqp = new BinancePortfolioToAMQP({ send_message, logger, health_and_readiness })
    await portfolio_to_amqp.start()
  } catch (err: any) {
    Sentry.captureException(err)
    logger.error(`Error connecting to exchange: ${err}`)
    logger.error({ err })
    logger.error(`Error connecting to exchange: ${err.stack}`)
    service_is_healthy.healthy(false) // it seems service isn't exiting on soft exit, but add this to make sure
    return
  }
}

main().catch((err) => {
  Sentry.captureException(err)
  logger.error(`Error in main loop: ${err}`)
  logger.error({ err })
  logger.error(`Error in main loop: ${err.stack}`)
})

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
