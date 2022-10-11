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
import { Balance, Portfolio } from "../../../../interfaces/portfolio"
import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { BinanceOrderData } from "../../../../interfaces/exchanges/binance/order_callbacks"
import { MasterPortfolioClass, PortfolioBitchClass } from "./interfaces"
import { PortfolioPublisher } from "./portfolio-publisher"
import { PortfolioTracker } from "./portfolio-tracker"
import express from "express"
import { SendMessageFunc } from "../../../../interfaces/send-message"
import { PortfolioSnapshot } from "../../../../classes/utils/portfolio-snapshot"
import { ServiceLogger } from "../../../../interfaces/logger"
import { BinanceExchangeInfoGetter } from "../../../../classes/exchanges/binance/exchange-info-getter"
import { BunyanServiceLogger } from "../../../../lib/service-logger"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_type: "ServiceStarting" })

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

export class BinancePortfolioToAMQP implements PortfolioBitchClass {
  send_message: SendMessageFunc
  logger: ServiceLogger
  ee: BinanceType
  master: MasterPortfolioClass // duplicated
  portfolio_tracker: PortfolioTracker // duplicated
  order_execution_tracker: OrderExecutionTracker
  exchange_identifier: ExchangeIdentifier_V3
  portfolio: Portfolio = { balances: [], object_type: "SpotPortfolio" }
  publisher: PortfolioPublisher
  health_and_readiness: HealthAndReadiness
  portfolio_snapshot: PortfolioSnapshot

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

    this.publisher = new PortfolioPublisher({
      logger,
      event_name: "SpotPortfolio",
      health_and_readiness,
      exchange_identifier: this.exchange_identifier,
    })

    this.portfolio_tracker = new PortfolioTracker({
      logger,
      send_message,
      publisher: this.publisher,
      health_and_readiness: health_and_readiness.addSubsystem({
        name: "PortfolioTracker",
        healthy: true,
        initialised: false,
      }),
    })

    this.master = this.portfolio_tracker
    this.send_message = send_message
    logger.info("Live monitoring mode")
    if (!process.env.BINANCE_API_KEY) throw new Error(`Missing BINANCE_API_KEY in ENV`)
    if (!process.env.BINANCE_API_SECRET) throw new Error(`Missing BINANCE_API_SECRET in ENV`)
    this.ee = Binance({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
    })

    let exchange_info_getter = new BinanceExchangeInfoGetter({ ee: this.ee })
    this.portfolio_snapshot = new PortfolioSnapshot({
      logger,
      exchange_info_getter,
    })

    this.order_execution_tracker = new OrderExecutionTracker({
      ee: this.ee,
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

    setInterval(
      this.portfolio_tracker.update_and_report_portfolio.bind(this.portfolio_tracker),
      1000 * 60 * 60 * 6
    )
    await this.update_portfolio_from_exchange() // automatically triggers report_current_portfolio

    this.order_execution_tracker.main()
  }

  async update_portfolio_from_exchange() {
    this.portfolio.prices = await this.get_prices_from_exchange()
    this.portfolio.balances = await this.portfolio_snapshot.take_snapshot()
    this.master.set_portfolio_for_exchange({
      exchange_identifier: this.exchange_identifier,
      portfolio: this.portfolio,
    })
  }

  async order_filled(data: BinanceOrderData): Promise<void> {
    this.logger.info(`Binance: ${data.side} order on ${data.symbol} filled.`)
    await this.update_portfolio_from_exchange()
  }

  async get_prices_from_exchange() {
    // TODO: refresh prices but maybe cache them? If at daily close we enter lots of positions it would be good not to call this repeatedly
    this.logger.event(
      { level: "warn" },
      {
        object_type: "TODO",
        msg: `Getting prices from exchange, this is not cached and If at daily close we enter lots of positions it would be good not to call this repeatedly.`,
      }
    )

    try {
      return await this.ee.prices()
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  }

  async get_balances_from_exchange(): Promise<Balance[]> {
    try {
      let response = await this.ee.accountInfo()
      /* Hardcode remove AGI from balances as it's dud */
      let balances = response.balances.filter((bal) => bal.asset !== "AGI")
      return balances
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
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
