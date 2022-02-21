#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * BinancePortfolioToAMQP implements PortfolioBitchClass
 *
 * callbacks on OrderExecutionTracker.
 *
 * order_filled callback calls update_portfolio_from_exchange that updates price and portfolio data
 * in the master. I think the master might then callback into the publisher to fire the event.
 *
 * TODO: MasterPortfolioClass was I think an attempt at having one shared master portfolio
 * updated by multiple exchange connected classes. Perhaps we could mimic that and
 * have exchange specific events be collated by a master portfolio tracker that then
 * sends out a master portfolio updated event, merging all exchanges positions.
 *
 */

// TODO: health_and_readiness isn't great here. Healthy() can be called from multiple places in the code, one true could overwrite another (false)

// (OLD) TODO:
// 1. Take initial portfolio code from the position sizer
// 3. Maintain portfolio state - probably just in-process

import { strict as assert } from "assert"
const service_name = "binance-portfolio-to-amqp"
const event_expiration_seconds = "60"

import { MasterPortfolioClass, PortfolioBitchClass } from "./interfaces"
import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../interfaces/logger"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Connection } from "amqplib"
import { GenericTopicPublisher } from "../../classes/amqp/generic-publishers"
import { MyEventNameType } from "../../classes/amqp/message-routing"

import { OrderExecutionTracker } from "../../classes/exchanges/binance/order_execution_tracker"
import { BinanceOrderData } from "../../interfaces/order_callbacks"
import { ExchangeIdentifier } from "../../events/shared/exchange-identifier"
import { Balance, Portfolio } from "../../interfaces/portfolio"

import { PortfolioUtils } from "../../classes/utils/portfolio-utils"
import { HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { RedisClient } from "redis"
import { RedisOrderContextPersistance } from "../../classes/spot/persistence/redis-implementation/redis-order-context-persistence"

// Let's keep this code, could become part of ensuring same format events accross exchanges
export class PortfolioPublisher {
  logger: Logger
  closeTradesWebSocket: (() => void) | undefined
  connection: Connection | undefined
  channel: any
  pub: GenericTopicPublisher
  event_name: MyEventNameType
  health_and_readiness: HealthAndReadinessSubsystem

  constructor({
    logger,
    event_name,
    health_and_readiness,
  }: {
    logger: Logger
    event_name: MyEventNameType
    health_and_readiness: HealthAndReadinessSubsystem
  }) {
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.event_name = event_name
    this.pub = new GenericTopicPublisher({ logger, event_name })
  }

  async connect(): Promise<void> {
    await this.pub.connect()
    this.health_and_readiness.ready(true)
  }

  async publish(event: Portfolio): Promise<void> {
    // Extract only those fields we want to publish
    let trimmed_event: Portfolio = {
      object_type: "Portfolio",
      usd_value: event.usd_value,
      btc_value: event.btc_value,
      balances: event.balances,
      prices: event.prices,
    }
    const options = {
      expiration: event_expiration_seconds,
      persistent: false,
      timestamp: Date.now(),
    }
    try {
      await this.pub.publish(trimmed_event, options)
    } catch (e) {
      this.health_and_readiness.healthy(false)
    }
  }

  async shutdown_streams() {
    if (this.pub) this.pub.shutdown_streams()
  }
}

// This class is a bit strange because it was originally intended to conglomerate multiple
// portfolio accounts into one view for publishing.
class PortfolioTracker implements MasterPortfolioClass {
  send_message: Function
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
    send_message: (msg: string) => void
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

      await this.publisher.publish(portfolio)
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

export class BinancePortfolioToAMQP implements PortfolioBitchClass {
  send_message: Function
  logger: Logger
  ee: BinanceType
  master: MasterPortfolioClass // duplicated
  portfolio_tracker: PortfolioTracker // duplicated
  order_execution_tracker: OrderExecutionTracker
  exchange_identifier: ExchangeIdentifier
  portfolio: Portfolio = { balances: [], object_type: "SpotBinancePortfolio" }
  publisher: PortfolioPublisher
  health_and_readiness: HealthAndReadinessSubsystem

  constructor({
    send_message,
    logger,
    health_and_readiness,
    redis,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    health_and_readiness: HealthAndReadinessSubsystem
    redis: RedisClient
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)

    this.health_and_readiness = health_and_readiness

    this.publisher = new PortfolioPublisher({
      logger,
      event_name: "SpotBinancePortfolio",
      health_and_readiness,
    })

    this.portfolio_tracker = new PortfolioTracker({
      logger,
      send_message,
      publisher: this.publisher,
      health_and_readiness,
    })

    this.master = this.portfolio_tracker
    this.send_message = send_message
    logger.info("Live monitoring mode")
    this.exchange_identifier = { exchange: "binance", account: "default" }
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
    })
  }

  async start() {
    try {
      await this.publisher.connect()
    } catch (error: any) {
      Sentry.captureException(error)
      this.logger.error(`Error connecting to AMQP: ${error}`)
      this.logger.error(error)
      this.logger.error(`Error connecting to AMQP: ${error.stack}`)
      // TODO: this should be more like a HealthCheck class
      this.health_and_readiness.healthy(false)
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
    } catch (error) {
      Sentry.captureException(error)
      throw error
    }
  }

  async get_balances_from_exchange(): Promise<Balance[]> {
    try {
      let response = await this.ee.accountInfo()
      /* Hardcode remove AGI from balances as it's dud */
      let balances = response.balances.filter((bal) => bal.asset !== "AGI")
      return balances
    } catch (error) {
      Sentry.captureException(error)
      throw error
    }
  }
}
