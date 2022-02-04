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
const service_name = "binance-to-amqp"

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

let redis: RedisClient | undefined
try {
  set_redis_logger(logger)
  redis = get_redis_client()
} catch (error) {
  // We don't want redis failures to take down this logger service
  // redis is just used to print the edge for information
  logger.error(error)
  Sentry.captureException(error)
}

const health = new HealthAndReadiness({ logger, send_message })
const service_is_healthy = health.addSubsystem({ name: "global", ready: true, healthy: true })

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  try {
    let health_and_readiness = health.addSubsystem({
      name: "binance-portfolio-to-amqp",
      ready: false,
      healthy: false,
    })
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

import express, { Request, Response } from "express"
import { RedisClient } from "redis"
import { get_redis_client, set_redis_logger } from "../../lib/redis"
var app = express()
app.get("/health", function (req: Request, res: Response) {
  if (health.healthy()) res.send({ status: "OK" })
  else res.status(500).json({ status: "UNHEALTHY" })
})
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
