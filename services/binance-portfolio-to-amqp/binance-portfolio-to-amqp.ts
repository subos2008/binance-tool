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

import { HealthAndReadiness } from "../../classes/health_and_readiness"

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const _logger: Logger = new LoggerClass({ silent: false })

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

process.on("unhandledRejection", (error) => {
  _logger.error(error)
  Sentry.captureException(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import { BinancePortfolioToAMQP } from "./portfolio"

let logger: Logger = _logger
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
import express from "express"

import { RedisClient } from "redis"
import { get_redis_client, set_redis_logger } from "../../lib/redis"
set_redis_logger(logger)
let redis: RedisClient = get_redis_client()

const health_and_readiness = new HealthAndReadiness({ logger, send_message })
const service_is_healthy = health_and_readiness.addSubsystem({ name: "global", ready: true, healthy: true })

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  try {
    let portfolio_to_amqp = new BinancePortfolioToAMQP({ send_message, logger, health_and_readiness, redis })
    await portfolio_to_amqp.start()
  } catch (error: any) {
    Sentry.captureException(error)
    logger.error(`Error connecting to exchange: ${error}`)
    logger.error(error)
    logger.error(`Error connecting to exchange: ${error.stack}`)
    service_is_healthy.healthy(false) // it seems service isn't exiting on soft exit, but add this to make sure
    return
  }
}

main().catch((error) => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`)
  logger.error(error)
  logger.error(`Error in main loop: ${error.stack}`)
})

var app = express()
app.get("/health_and_readiness", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
