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
//  1. Could also check redis-trades matches position sizes
//  1. Doesn't currently re-publish on deposits/withdrawals

// Config
const service_name = "binance-order-data-to-generic-order-data"

import { HealthAndReadiness } from "../../../../../../classes/health_and_readiness"
import { SendMessage } from "../../../../../../classes/send_message/publish"

import express from "express"
import { SendMessageFunc } from "../../../../../../interfaces/send-message"
require("dotenv").config()

import Sentry from "../../../../../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { BunyanServiceLogger } from "../../../../../../lib/service-logger"
import { ServiceLogger } from "../../../../../../interfaces/logger"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_class: "event", object_type: "ServiceStarting", msg: "Service starting" })

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
const service_is_healthy = health_and_readiness.addSubsystem({
  name: "global",
  healthy: true,
  initialised: false,
})

import { BigNumber } from "bignumber.js"
import { BinanceExecutionReportToGenericOrderUpdate } from "./main"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
  service_is_healthy.healthy(false)
})

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  try {
    let portfolio_to_amqp = new BinanceExecutionReportToGenericOrderUpdate({
      send_message,
      logger,
      health_and_readiness,
    })
    await portfolio_to_amqp.start()
  } catch (err: any) {
    logger.exception({}, err, `Error connecting to AMQP`)
    service_is_healthy.healthy(false)
    return
  }
}

main()
  .catch((err) => {
    logger.exception({}, err)
  })
  .then(() => service_is_healthy.initialised(true))

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
