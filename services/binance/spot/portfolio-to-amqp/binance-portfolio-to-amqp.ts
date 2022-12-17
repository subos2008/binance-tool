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

const exchange_identifier: ExchangeIdentifier_V4 = {
  exchange_type: "spot",
  version: 4,
  exchange: "binance",
}

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { SendMessage } from "../../../../classes/send_message/publish"
import { OrderExecutionTracker } from "../orders-to-amqp/spot-order-execution-tracker"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../../events/shared/exchange-identifier"
import { Balance, SpotPortfolio } from "../../../../interfaces/portfolio"
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
logger.event({}, { object_class: "event", object_type: "ServiceStarting", msg: "Service starting" })

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
const service_is_healthy = health_and_readiness.addSubsystem({
  name: "global",
  healthy: true,
  initialised: true,
})

process.on("unhandledRejection", (err) => {
  logger.exception({}, err)
  service_is_healthy.healthy(false)
  send_message(`UnhandledPromiseRejection: ${err}`)
})

export class BinancePortfolioToAMQP {
  send_message: SendMessageFunc
  logger: ServiceLogger
  order_execution_tracker: OrderExecutionTracker
  exchange_identifier: ExchangeIdentifier_V4
  publisher: PortfolioPublisher
  health_and_readiness: HealthAndReadiness
  portfolio_snapshot: PortfolioSnapshot
  price_getter: CurrentAllPricesGetter
  portfolio_utils: SpotPortfolioUtils
  update_timeout: NodeJS.Timeout | null = null

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

    this.exchange_identifier = { exchange: "binance", exchange_type: "spot", version: 4 }

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
      this.logger.exception({}, err)
      return
    }

    setInterval(this.update_portfolio_from_exchange.bind(this), 1000 * 60 * 60 * 6)
    this.update_portfolio_from_exchange_after_delay()

    this.order_execution_tracker.main()
  }

  async update_portfolio_from_exchange() {
    let prices = await this.get_prices_from_exchange()
    let portfolio: SpotPortfolio = {
      object_type: "SpotPortfolio",
      version: 1,
      timestamp_ms: Date.now(),
      exchange_identifier: this.exchange_identifier,
      prices,
      balances: await this.portfolio_snapshot.take_snapshot({ prices }),
    }

    await this.report_portfolio(portfolio)
  }

  // resets delay when called, allows us to just update once at the end if there
  // is a series of orders
  update_portfolio_from_exchange_after_delay() {
    let seconds = 30
    if (this.update_timeout) clearTimeout(this.update_timeout)
    this.update_timeout = setTimeout(this.update_portfolio_from_exchange.bind(this), 1000 * seconds)
  }

  async order_filled(data: BinanceOrderData): Promise<void> {
    this.logger.info(`Binance: ${data.side} order on ${data.symbol} filled.`)
    this.update_portfolio_from_exchange_after_delay()
  }

  async get_prices_from_exchange() {
    try {
      return await this.price_getter.prices()
    } catch (err) {
      logger.exception({}, err)
      throw err
    }
  }

  async report_portfolio(_portfolio: SpotPortfolio) {
    try {
      let portfolio = await this.decorate_portfolio(_portfolio, quote_currency)
      // if (!portfolio) {
      //   this.logger.info(`No portfolio, skipping.`)
      //   this.logger.warn(`TODO: we still want to verify this with the exchange and publish an empty portfolio`)
      //   return
      // }
      this.logger.todo({}, `report_portfolio() needs testing with an empty portfolio`)

      try {
        // This is just for the logfiles, we don't use this to send the event
        let msg = `U: ${portfolio.usd_value}`
        try {
          msg += " as " + this.portfolio_utils.balances_to_string(portfolio, "BUSD")
        } catch (err) {
          this.logger.exception({}, err)
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
        this.logger.exception({}, err)
      }

      try {
        await this.publisher.publish(portfolio)
      } catch (err) {
        this.logger.exception({}, err)
      }

      try {
        if (portfolio.prices) {
          let trigger = new BigNumber("50")
          let balance: Balance | undefined = this.portfolio_utils.balance_for_asset({ asset: "BNB", portfolio })
          let bnb_balance = new BigNumber(balance ? balance.free : 0)
          let bnb_balance_in_usd = this.portfolio_utils.convert_base_to_quote_currency({
            base_quantity: bnb_balance,
            base_currency: "BNB",
            quote_currency: "BUSD",
            prices: portfolio.prices,
          })
          if (bnb_balance_in_usd.isLessThan(trigger))
            this.send_message(`Free BNB balance in BUSD fell below ${trigger.toString()}`)
        }
      } catch (err) {
        logger.exception({}, err)
      }

      try {
        if (portfolio.prices) {
          let quote_amount = new BigNumber(10)
          let quote_currency = "BUSD"
          let free_balances = this.portfolio_utils.get_balances_with_free_greater_than({
            portfolio,
            quote_currency,
            quote_amount,
            prices: portfolio.prices,
            base_assets_to_ignore: [quote_currency, "BNB", "DNT"],
          })
          if (free_balances.length > 0) {
            let string =
              `⚠️ Unexpected assets with free balances gt ${quote_amount.toFixed()} ${quote_currency}: [` +
              free_balances.map((b) => `${b.asset}: ${b.quote_amount?.dp(0).toFixed()}`).join(", ") +
              "]"
            this.send_message(string)
          } else {
            this.send_message(`✅ no unexpected free balance.`)
          }
        }
      } catch (err) {
        this.logger.exception({}, err)
      }
    } catch (err) {
      logger.exception({}, err)
    }
  }

  async decorate_portfolio(portfolio: SpotPortfolio, quote_currency: string): Promise<SpotPortfolio> {
    portfolio = this.portfolio_utils.add_quote_value_to_portfolio_balances({
      portfolio,
      quote_currency,
    }).portfolio
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
    service_is_healthy.healthy(false) // it seems service isn't exiting on soft exit, but add this to make sure
    logger.exception({}, err)
    logger.error(`Error connecting to exchange: ${err}`)
    logger.error(`Error connecting to exchange: ${err.stack}`)
    return
  }
}

main().catch((err) => {
  logger.exception({}, err)
  logger.error(`Error in main loop: ${err}`)
  logger.error(`Error in main loop: ${err.stack}`)
})

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
