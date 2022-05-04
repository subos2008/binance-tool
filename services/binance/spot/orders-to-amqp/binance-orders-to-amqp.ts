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
const service_name = "binance-orders-to-amqp"

import { HealthAndReadiness } from "../../../../classes/health_and_readiness"

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

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

import { BinanceSpotOrdersToAMQP } from "./spot-order"

import { get_redis_client, set_redis_logger } from "../../../../lib/redis"

const health = new HealthAndReadiness({ logger, send_message })
const service_is_healthy = health.addSubsystem({ name: "global", ready: true, healthy: true })

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  set_redis_logger(logger)
  let redis = get_redis_client()

  try {
    let health_and_readiness = health.addSubsystem({
      name: "binance-orders-to-amqp",
      ready: false,
      healthy: false,
    })
    let portfolio_to_amqp = new BinanceSpotOrdersToAMQP({ send_message, logger, health_and_readiness, redis })
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
var app = express()
app.get("/health", health.health_handler.bind(health))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
