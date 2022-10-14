#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

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

require("dotenv").config()

import { strict as assert } from "assert"
import { MasterPortfolioClass, PortfolioBitchClass } from "./interfaces"
import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"
import Sentry from "../../../../lib/sentry"

// TODO:
// 1. Take initial portfolio code from the position sizer
// 2. Add stream watching code from the order tracker
// 3. Maintain portfolio state - probably just in-process
// 4. Publish to telegram when portfolio changes

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { OrderExecutionTracker } from "../orders-to-amqp/spot-order-execution-tracker"
import { BinanceOrderData } from "../../../../interfaces/exchanges/binance/order_callbacks"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { Portfolio } from "../../../../interfaces/portfolio"
import { PortfolioSnapshot } from "../../../../classes/utils/portfolio-snapshot"
import { BinanceExchangeInfoGetter } from "../../../../classes/exchanges/binance/exchange-info-getter"
import { ServiceLogger } from "../../../../interfaces/logger"
import { BunyanServiceLogger } from "../../../../lib/service-logger"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_type: "ServiceStarting", msg: "Service starting" })

export class BinancePortfolioTracker implements PortfolioBitchClass {
  send_message: Function
  logger: ServiceLogger
  ee: BinanceType
  master: MasterPortfolioClass
  order_execution_tracker: OrderExecutionTracker
  exchange_identifier: ExchangeIdentifier_V3
  portfolio: Portfolio = { balances: [], object_type: "Portfolio" }
  portfolio_snapshot: PortfolioSnapshot

  constructor({
    send_message,
    logger,
    master,
  }: {
    send_message: (msg: string) => void
    logger: ServiceLogger
    master: MasterPortfolioClass
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.master = master
    this.send_message = send_message
    this.exchange_identifier = { exchange: "binance", account: "default", type: "spot", version: "v3" }
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
      exchange_identifier: this.exchange_identifier,
    })
  }

  async start() {
    this.order_execution_tracker.main()
  }

  async update_portfolio_from_exchange() {
    // TODO: refresh prices but maybe cache them? If at daily close we enter lots of positions it would be good not to call this repeatedly
    this.portfolio.prices = await this.get_prices_from_exchange()
    this.portfolio.balances = await this.portfolio_snapshot.take_snapshot({ prices: this.portfolio.prices })
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
}
