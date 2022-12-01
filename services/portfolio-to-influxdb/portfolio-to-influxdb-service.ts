#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

/**
 * Event/message listener
 */

import { strict as assert } from "assert"
const service_name = "portfolio-to-influxdb"

require("dotenv").config()

import Sentry from "../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { SendMessage } from "../../classes/send_message/publish"
import influxdb from "../../lib/influxdb"
import { Point } from "@influxdata/influxdb-client"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Channel, Message } from "amqplib"
import { ContextTags, SendMessageFunc } from "../../interfaces/send-message"
import express from "express"
import { TypedListenerFactory } from "../../classes/amqp/listener-factory-v2"
import { TypedMessageProcessor } from "../../classes/amqp/interfaces"
import { ServiceLogger } from "../../interfaces/logger"
import { BunyanServiceLogger } from "../../lib/service-logger"
import { SpotPortfolio } from "../../interfaces/portfolio"

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
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
  service_is_healthy.healthy(false)
})

class EventLogger implements TypedMessageProcessor<SpotPortfolio> {
  send_message: Function
  logger: ServiceLogger
  health_and_readiness: HealthAndReadiness
  subsystem_influxdb: HealthAndReadinessSubsystem

  constructor({
    send_message,
    logger,
    health_and_readiness,
  }: {
    send_message: (msg: string) => void
    logger: ServiceLogger
    health_and_readiness: HealthAndReadiness
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.health_and_readiness = health_and_readiness
    this.subsystem_influxdb = health_and_readiness.addSubsystem({
      name: "influxdb",
      healthy: true,
      initialised: true,
    })
  }

  async start() {
    await this.register_message_processors()
  }

  async register_message_processors() {
    let event_name: MyEventNameType = "SpotPortfolio"
    let listener_factory = new TypedListenerFactory({ logger })

    listener_factory.build_listener<SpotPortfolio>({
      event_name,
      message_processor: this,
      health_and_readiness: this.health_and_readiness,
      prefetch_one: false,
      service_name,
      eat_exceptions: false,
    })
  }

  async process_message(msg: SpotPortfolio, channel: Channel, amqp_event: Message): Promise<void> {
    // Upload balances to influxdb
    const exchange = "binance"
    const account = "default"
    const account_type = "spot"
    const name = `balance`

    let tags: ContextTags = { exchange, exchange_type: account_type }
    this.logger.debug(tags, `Submitting SpotPortfolio to InfluxDB`)
    try {
      let usd_value = msg.usd_value
      const point1 = new Point(name)
        .tag("exchange", exchange)
        .tag("account", account)
        .tag("account_type", account_type)
        .floatField("usd", usd_value)
      await influxdb.writePoint(point1)
      channel.ack(amqp_event)
    } catch (err) {
      this.logger.exception(tags, err, `Error "${err}" uploading ${name} to influxdb.`)
      Sentry.captureException(err)
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
  logger.error(`soft_exit called, exit_code: ${exit_code}`)
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
