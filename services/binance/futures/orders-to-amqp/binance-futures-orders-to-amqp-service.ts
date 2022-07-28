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
const service_name = "binance-futures-orders-to-amqp"

import { HealthAndReadiness } from "../../../../classes/health_and_readiness"

require("dotenv").config()

import Sentry from "../../../../lib/sentry"

Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../../../lib/faux_logger"
const logger: Logger = new Logger({ silent: false })

import { SendMessage, SendMessageFunc } from "../../../../classes/send_message/publish"
const health_and_readiness = new HealthAndReadiness({ logger })

const send_message: SendMessageFunc = new SendMessage({ service_name, logger,health_and_readiness }).build()

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

const exchange_identifier: ExchangeIdentifier_V3 = {
  version: "v3",
  exchange: "binance",
  account: "default",
  type: "futures",
}

import { BinanceFuturesOrdersToAMQP } from "./binance-futures-orders-to-amqp"

import { get_redis_client, set_redis_logger } from "../../../../lib/redis"

const service_is_healthy = health_and_readiness.addSubsystem({ name: "global", ready: true, healthy: true })

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  set_redis_logger(logger)
  let redis = get_redis_client()

  try {
    let portfolio_to_amqp = new BinanceFuturesOrdersToAMQP({
      send_message,
      logger,
      health_and_readiness,
      redis,
      exchange_identifier,
    })
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

import express from "express"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
