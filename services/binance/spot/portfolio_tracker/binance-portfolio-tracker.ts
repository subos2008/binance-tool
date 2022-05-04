#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

// portfolio-tracker service: maintains the current portfolio by
// getting the portfolio on startup and then monitoring the streams
// and tracking deltas.
//
// On changes:
//  1. Publishes to telegram
//  2. Publishes to nw
//  3. Updates UI on any connected web-streams
//
// Provides API/Events for:
//  1. Current portfolio and portfolio value in a given unit (BTC, USDT)
//     To assist the position-sizer
//  2. Publishes events when the portfolio changes
//  3. Webstream maybe for subscribing to changes? Could also be done by
//     servers watching the AMQP events
//
// Thoughts:
//  1. Could also check redis-trades matches position sizes

import { strict as assert } from "assert"
const service_name = "portfolio-tracker"

import { MasterPortfolioClass, PortfolioBitchClass } from "./interfaces"
import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

// TODO:
// 1. Take initial portfolio code from the position sizer
// 2. Add stream watching code from the order tracker
// 3. Maintain portfolio state - probably just in-process
// 4. Publish to telegram when portfolio changes

import { Logger } from "../../../../lib/faux_logger"
const logger: Logger = new Logger({ silent: false })

import { SendMessage, SendMessageFunc } from "../../../../lib/telegram-v2"
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
})

import { get_redis_client, set_redis_logger } from "../../../../lib/redis"
set_redis_logger(logger)
let redis = get_redis_client()

import { OrderExecutionTracker } from "../../../../classes/exchanges/binance/order_execution_tracker"
import { BinanceOrderData } from "../../../../interfaces/order_callbacks"
import { ExchangeIdentifier, ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { Balance, Portfolio } from "../../../../interfaces/portfolio"
import { RedisOrderContextPersistance } from "../../../../classes/spot/persistence/redis-implementation/redis-order-context-persistence"

export class BinancePortfolioTracker implements PortfolioBitchClass {
  send_message: Function
  logger: Logger
  ee: BinanceType
  master: MasterPortfolioClass
  order_execution_tracker: OrderExecutionTracker
  exchange_identifier: ExchangeIdentifier_V3
  portfolio: Portfolio = { balances: [], object_type: "Portfolio" }

  constructor({
    send_message,
    logger,
    master,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    master: MasterPortfolioClass
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.master = master
    this.send_message = send_message
    logger.info("Live monitoring mode")
    this.exchange_identifier = { exchange: "binance", account: "default", type: "spot", version: "v3" }
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
      exchange_identifier: this.exchange_identifier,
    })
  }

  async start() {
    this.order_execution_tracker.main()
  }

  async update_portfolio_from_exchange() {
    // TODO: refresh prices but maybe cache them? If at daily close we enter lots of positions it would be good not to call this repeatedly
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
