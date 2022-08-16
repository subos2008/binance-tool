#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

require("dotenv").config()

const service_name = "amqp-send-message-telegram"

import express from "express"
import { AMQP_SendMessageListener } from "../send-message-listener"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { SendMessage } from "./send-message"
import { SendMessageToTelegramForwarder } from "./forwarder"
import { ServiceLogger } from "../../../../interfaces/logger"
import { BunyanServiceLogger } from "../../../../lib/service-logger"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
const health_and_readiness = new HealthAndReadiness({ logger })
const service_is_healthy = health_and_readiness.addSubsystem({ name: "global", ready: true, healthy: true })

logger.info(`Service starting`)

process.on("unhandledRejection", (err) => {
  logger.error({}, `Unhandled Exception: ${err}`)
  logger.exception({}, err)
  service_is_healthy.healthy(false)
})

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  let send_message = new SendMessage({ logger })

  let listener = new AMQP_SendMessageListener({
    logger,
    health_and_readiness,
    callback: new SendMessageToTelegramForwarder({ send_message: send_message, logger }),
    service_name,
  })

  await listener.start()
}

main().catch((err) => {
  logger.exception({}, err)
  soft_exit(1, `Error in main loop: ${err}`)
})

// Note this method returns!
function soft_exit(exit_code: number | null = null, reason: string) {
  service_is_healthy.healthy(false) // it seems service isn't exiting on soft exit, but add this to make sure
  logger.error(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) process.exitCode = exit_code
  // Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
app.get("/ready", health_and_readiness.readiness_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
