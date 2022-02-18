#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * Event/message listener
 */

import { strict as assert } from "assert"
const service_name = "event-persistance"

import { ListenerFactory } from "../../classes/amqp/listener-factory"

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../lib/faux_logger"
const logger = new Logger({ silent: false })

logger.info(`Service starting.`)

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

process.on("unhandledRejection", (error) => {
  logger.error(error)
  Sentry.captureException(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import influxdb from "../../lib/influxdb"

import { MessageProcessor } from "../../classes/amqp/interfaces"
import { Point } from "@influxdata/influxdb-client"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Channel } from "amqplib"

const health_and_readiness = new HealthAndReadiness({ logger, send_message })
const service_is_healthy = health_and_readiness.addSubsystem({ name: "global", ready: true, healthy: true })

class EventLogger implements MessageProcessor {
  send_message: Function
  logger: Logger
  health_and_readiness: HealthAndReadiness
  subsystem_influxdb: HealthAndReadinessSubsystem

  constructor({
    send_message,
    logger,
    health_and_readiness,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    health_and_readiness: HealthAndReadiness
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.health_and_readiness = health_and_readiness
    this.subsystem_influxdb = health_and_readiness.addSubsystem({ name: "influxdb", ready: true, healthy: true })
  }

  async start() {
    await this.register_message_processors()
  }

  async register_message_processors() {
    let event_name: MyEventNameType = "SpotBinancePortfolio"
    let listener_factory = new ListenerFactory({ logger })
    let health_and_readiness = this.health_and_readiness.addSubsystem({
      name: event_name,
      ready: false,
      healthy: false,
    })
    listener_factory.build_isolated_listener({
      event_name,
      message_processor: this,
      health_and_readiness,
    })
  }

  async process_message(event: any, channel: Channel): Promise<void> {
    this.logger.info(event.content.toString())

    // Upload balances to influxdb
    let exchange = "binance"
    let account = "default"
    let account_type = "spot"
    let name = `balance`
    try {
      let msg = JSON.parse(event.content.toString())
      // console.log(msg)
      let usd_value = msg.usd_value
      let btc_value = msg.btc_value
      const point1 = new Point(name)
        .tag("exchange", exchange)
        .tag("account", account)
        .tag("account_type", account_type)
        .floatField("usd", usd_value)
        .floatField("btc", btc_value)
      await influxdb.writePoint(point1)
      channel.ack(event)
      // need to ACK
    } catch (e) {
      console.log(`Error "${e}" uploading ${name} to influxdb.`)
      console.log(e)
      Sentry.captureException(e)
      this.subsystem_influxdb.healthy(false)
      soft_exit(1, "Exeception submitting to Influxdb")
    }
  }
}

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  let foo = new EventLogger({ logger, send_message, health_and_readiness })
  foo.start()
}

main().catch((error) => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`)
  logger.error(error)
  logger.error(`Error in main loop: ${error.stack}`)
  soft_exit(1, `Error in main loop: ${error}`)
})

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null, reason: string) {
  service_is_healthy.healthy(false) // it seems service isn't exiting on soft exit, but add this to make sure
  logger.error(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) process.exitCode = exit_code
  Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

import express, { Request, Response } from "express"
var app = express()
app.get("/health", function (req: Request, res: Response) {
  if (health_and_readiness.healthy()) res.send({ status: "OK" })
  else res.status(500).json({ status: "UNHEALTHY" })
})
app.get("/ready", function (req, res) {
  if (health_and_readiness.ready()) res.send({ status: "OK" })
  else res.status(500).json({ status: "NOT READY" })
})
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
