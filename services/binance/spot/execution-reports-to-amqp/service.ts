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
const service_name = "binance-execution-reports-to-amqp"

import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { SendMessage } from "../../../../classes/send_message/publish"

import express from "express"
import { SendMessageFunc } from "../../../../interfaces/send-message"
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

import { BinanceExecutionReportToAMQP } from "./binance-execution-report-to-amqp"
import { ServiceLogger } from "../../../../interfaces/logger"
import { BunyanServiceLogger } from "../../../../lib/service-logger"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_class: "event", object_type: "ServiceStarting", msg: "Service starting" })

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
const service_is_healthy = health_and_readiness.addSubsystem({
  name: "global",
  healthy: true,
  initialised: false,
})

process.on("unhandledRejection", (err) => {
  logger.exception({}, err)
  service_is_healthy.healthy(false)
  send_message(`UnhandledPromiseRejection: ${err}`)
})

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  try {
    let portfolio_to_amqp = new BinanceExecutionReportToAMQP({ send_message, logger, health_and_readiness })
    await portfolio_to_amqp.start()
    service_is_healthy.initialised(true)
  } catch (err: any) {
    logger.exception({}, err)
    service_is_healthy.healthy(false) // it seems service isn't exiting on soft exit, but add this to make sure
    return
  }
}

main().catch((err) => {
  logger.exception({}, err)
})

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
