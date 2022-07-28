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

// Config
const service_name = "binance-portfolio-to-amqp"

import { strict as assert } from "assert"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"

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

import { SendMessage, SendMessageFunc } from "../../../../classes/send_message/publish"

import { Logger } from "../../../../lib/faux_logger"
const _logger = new Logger({ silent: false })

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

process.on("unhandledRejection", (err) => {
  _logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
})

import { OrderExecutionTracker } from "../../../../classes/exchanges/binance/spot-order-execution-tracker"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { Balance, Portfolio } from "../../../../interfaces/portfolio"
import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"

export class BinancePortfolioToAMQP implements PortfolioBitchClass {
  send_message: SendMessageFunc
  logger: Logger
  ee: BinanceType
  master: MasterPortfolioClass // duplicated
  portfolio_tracker: PortfolioTracker // duplicated
  order_execution_tracker: OrderExecutionTracker
  exchange_identifier: ExchangeIdentifier_V3
  portfolio: Portfolio = { balances: [], object_type: "SpotPortfolio" }
  publisher: PortfolioPublisher
  health_and_readiness: HealthAndReadiness

  constructor({
    send_message,
    logger,
    health_and_readiness,
    redis,
  }: {
    send_message: SendMessageFunc
    logger: Logger
    health_and_readiness: HealthAndReadiness
    redis: RedisClient
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)

    this.health_and_readiness = health_and_readiness

    this.exchange_identifier = { exchange: "binance", account: "default", type: "spot", version: "v3" }

    /*
      : health_and_readiness.addSubsystem({
        name: "PortfolioPublisher",
        ready: false,
        healthy: false,
      })
      */

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
        ready: false,
        healthy: false,
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

    let order_context_persistence = new RedisOrderContextPersistance({ logger, redis })
    this.order_execution_tracker = new OrderExecutionTracker({
      ee: this.ee,
      send_message,
      logger,
      order_callbacks: this,
      order_context_persistence,
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
    this.portfolio.balances = await this.get_balances_from_exchange()
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
    this.logger.warn(
      `Getting prices from exchange, this is not cached and If at daily close we enter lots of positions it would be good not to call this repeatedly.`
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

let logger: Logger = _logger
const health_and_readiness = new HealthAndReadiness({ logger })

const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
import express from "express"

import { RedisClient } from "redis"
import { get_redis_client, set_redis_logger } from "../../../../lib/redis"
import { BinanceOrderData } from "../../../../interfaces/exchanges/binance/order_callbacks"
import { MasterPortfolioClass, PortfolioBitchClass } from "./interfaces"
import { PortfolioPublisher } from "./portfolio-publisher"
import { PortfolioTracker } from "./portfolio-tracker"
import { RedisOrderContextPersistance } from "../../../../classes/persistent_state/redis-implementation/redis-order-context-persistence"
set_redis_logger(logger)
let redis: RedisClient = get_redis_client()

const service_is_healthy = health_and_readiness.addSubsystem({ name: "global", ready: true, healthy: true })

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  try {
    let portfolio_to_amqp = new BinancePortfolioToAMQP({ send_message, logger, health_and_readiness, redis })
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
app.get("/ready", health_and_readiness.readiness_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
