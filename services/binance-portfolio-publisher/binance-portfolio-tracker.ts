#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * BinancePortfolioTracker implements PortfolioBitchClass
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

// (OLD) TODO:
// 1. Take initial portfolio code from the position sizer
// 3. Maintain portfolio state - probably just in-process

import { strict as assert } from "assert"
const service_name = "binance-portfolio-tracker"

import { MasterPortfolioClass, PortfolioBitchClass } from "./interfaces"
import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"

require("dotenv").config()

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

import { OrderExecutionTracker } from "../../classes/exchanges/binance/order_execution_tracker"
import { BinanceOrderData } from "../../interfaces/order_callbacks"
import { ExchangeIdentifier } from "../../events/shared/exchange-identifier"
import { Balance, Portfolio } from "../../interfaces/portfolio"

export class BinancePortfolioTracker implements PortfolioBitchClass {
  send_message: Function
  logger: Logger
  ee: BinanceType
  master: MasterPortfolioClass
  order_execution_tracker: OrderExecutionTracker
  exchange_identifier: ExchangeIdentifier
  portfolio: Portfolio = { balances: [] }

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
    this.exchange_identifier = { exchange: "binance", account: "default" }
    if (!process.env.APIKEY) throw new Error(`Missing APIKEY in ENV`)
    if (!process.env.APISECRET) throw new Error(`Missing APISECRET in ENV`)
    this.ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET,
    })
    this.order_execution_tracker = new OrderExecutionTracker({
      ee: this.ee,
      send_message,
      logger,
      order_callbacks: this,
    })
  }

  async start() {
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
    this.logger.warn(`Getting prices from exchange, this is not cached and If at daily close we enter lots of positions it would be good not to call this repeatedly.`)
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
