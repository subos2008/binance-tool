#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

// portfolio-tracker service: periodic messages to the user
//    says what the current portfolio on exchange is

import { strict as assert } from "assert"
const service_name = "portfolio-tracker"

let exchange_identifier: ExchangeIdentifier_V3 = {
  version: "v3",
  exchange: "binance",
  type: "spot",
  account: "default",
}

import { MasterPortfolioClass, PortfolioBitchClass } from "./interfaces"

require("dotenv").config()

import Sentry from "../../../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { SendMessage } from "../../../../classes/send_message/publish"
import { Portfolio, Balance, SpotPortfolio } from "../../../../interfaces/portfolio"
import { BinancePortfolioTracker } from "./binance-portfolio-tracker"
import { ExchangeIdentifier, ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { SendDatadogMetrics } from "./send-datadog-metrics"
import { SendMessageFunc } from "../../../../interfaces/send-message"
import express from "express"
import { ServiceLogger } from "../../../../interfaces/logger"
import { BunyanServiceLogger } from "../../../../lib/service-logger"
import { SpotPortfolioUtils } from "../../../../classes/utils/spot-portfolio-utils"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_type: "ServiceStarting", msg: "Service starting" })

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message = new SendMessage({ service_name, logger, health_and_readiness }).build()
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

class PortfolioTracker implements MasterPortfolioClass {
  send_message: SendMessageFunc
  logger: ServiceLogger
  ee: any
  portfolios: { [exchange: string]: SpotPortfolio } = {}
  exchanges: { [exchange: string]: PortfolioBitchClass } = {}
  metrics: SendDatadogMetrics

  constructor({ send_message, logger }: { send_message: SendMessageFunc; logger: ServiceLogger }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.metrics = new SendDatadogMetrics({ logger })
  }

  async set_portfolio_for_exchange({
    exchange_identifier,
    portfolio,
  }: {
    exchange_identifier: ExchangeIdentifier
    portfolio: SpotPortfolio
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
      try {
        let length = portfolio.balances.length
        let msg = `B: ${portfolio.btc_value}, U: ${portfolio.usd_value}, #${length}`
        try {
          msg += " as " + portfolio_utils.balances_to_string(portfolio, "BTC")
        } catch (err) {
          Sentry.captureException(err)
          logger.error({ err })
        }
        if (portfolio.prices) {
          try {
            msg += ` BTCUSDT: ${new BigNumber(portfolio.prices["BTCUSDT"]).dp(0).toFixed()}`
          } catch (e) {
            /* just ignore */
          }
        }
        this.send_message(msg)
      } catch (err) {
        Sentry.captureException(err)
        logger.error({ err })
      }

      try {
        if (portfolio.prices) {
          let trigger = new BigNumber("50")
          let balance: Balance | undefined = portfolio_utils.balance_for_asset({ asset: "BNB", portfolio })
          let bnb_balance = new BigNumber(balance ? balance.free : 0)
          let bnb_balance_in_usd = portfolio_utils.convert_base_to_quote_currency({
            base_quantity: bnb_balance,
            base_currency: "BNB",
            quote_currency: "USDT",
            prices: portfolio.prices,
          })
          if (bnb_balance_in_usd.isLessThan(trigger))
            this.send_message(`Free BNB balance in USDT fell below ${trigger.toString()}`)
        }
      } catch (err) {
        Sentry.captureException(err)
        logger.error({ err })
      }

      try {
        if (portfolio.prices) {
          let quote_amount = new BigNumber(10)
          let quote_currency = "BUSD"
          let free_balances = portfolio_utils.get_balances_with_free_greater_than({
            portfolio,
            quote_currency,
            quote_amount,
            prices: portfolio.prices,
            base_assets_to_ignore: [quote_currency, "BNB"],
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
        Sentry.captureException(err)
        logger.error({ err })
      }
    } catch (err) {
      Sentry.captureException(err)
      logger.error({ err })
    }
  }

  async collapse_and_decorate_exchange_balances(): Promise<SpotPortfolio | undefined> {
    if (!this.portfolios) {
      this.logger.warn(`No portfolios present in portfilio-tracker`)
      return
    }
    let exchanges: string[] = Object.keys(this.portfolios)
    if (exchanges.length > 1) throw new Error(`Multiple exchanges not implemented yet`)
    return this.decorate_portfolio(this.portfolios[exchanges[0]])
  }

  async decorate_portfolio(portfolio: SpotPortfolio): Promise<SpotPortfolio> {
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
      .total.dp(3)
      .toFixed()
    if (!portfolio.prices) throw new Error(`No prices`)
    portfolio.usd_value = portfolio_utils
      .calculate_portfolio_value_in_quote_currency({ quote_currency: "BUSD", portfolio })
      .total.dp(0)
      .toFixed()
    this.metrics.submit_portfolio_as_metrics({ portfolio, exchange_identifier })
    return portfolio
  }
}

const portfolio_utils: SpotPortfolioUtils = new SpotPortfolioUtils({ logger })

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  let portfolio_tracker = new PortfolioTracker({ logger, send_message })
  let binance = new BinancePortfolioTracker({ send_message, logger, master: portfolio_tracker })
  binance.start()
  await binance.update_portfolio_from_exchange() // automatically triggers report_current_portfolio

  setInterval(portfolio_tracker.update_and_report_portfolio.bind(portfolio_tracker), 1000 * 60 * 60 * 6)
}

main().catch((err) => {
  Sentry.captureException(err)
  logger.error(`Error in main loop: ${err}`)
  logger.error({ err })
  logger.error(`Error in main loop: ${err.stack}`)
  soft_exit(1, `Error in main loop: ${err}`)
})

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null, reason: string) {
  service_is_healthy.healthy(false) // it seems service isn't exiting on soft exit, but add this to make sure
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) process.exitCode = exit_code
  Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
