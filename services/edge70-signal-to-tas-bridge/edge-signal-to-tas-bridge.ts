#!./node_modules/.bin/ts-node
/* eslint-disable no-console */


/**
 * Event/message listener
 */

/* config */
const service_name = "edge70-signal-to-tas-bridge"
const event_name: MyEventNameType = "Edge70Signal"

require("dotenv").config()

import { strict as assert } from "assert"
import express from "express"
import { ListenerFactory } from "../../classes/amqp/listener-factory"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { MessageProcessor } from "../../classes/amqp/interfaces"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Channel } from "amqplib"
import { SendMessage } from "../../classes/send_message/publish"
import { Edge70SignalProcessor } from "./interfaces"

import Sentry from "../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "./../../lib/faux_logger"
import { SendMessageFunc } from "../../interfaces/send-message"
import { Edge70Signal } from "../edge70-signals/interfaces/edge70-signal"
import { Edge70SignalFanout } from "./fanout"
const logger: Logger = new Logger({ silent: false })

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
})

let listener_factory = new ListenerFactory({ logger })

class Edge70MessageProcessor implements MessageProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType
  fanout: Edge70SignalProcessor

  constructor({
    send_message,
    logger,
    event_name,
    health_and_readiness,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    event_name: MyEventNameType
    health_and_readiness: HealthAndReadiness
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.event_name = event_name
    this.fanout = new Edge70SignalFanout({ logger, event_name, send_message })
    const amqp_health: HealthAndReadinessSubsystem = health_and_readiness.addSubsystem({
      name: `amqp-listener-${event_name}`,
      ready: true,
      healthy: true,
    })
    listener_factory.build_isolated_listener({
      event_name,
      message_processor: this,
      health_and_readiness: amqp_health,
      prefetch_one: false,
    }) // Add arbitrary data argument
  }

  async process_message(_event: any, channel: Channel) {
    try {
      this.logger.info(_event)
      channel.ack(_event)

      let Body = _event.content.toString()
      this.logger.info(Body)
      let signal: Edge70Signal = JSON.parse(Body)
      assert.equal(signal.object_type, "Edge70Signal")
      let { base_asset } = signal.market_identifier
      let { edge } = signal
      assert.equal(edge, "edge70")

      if (!base_asset) {
        throw new Error(
          `base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`
        )
      }
      this.fanout.process_signal(signal)
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err })
    }
  }
}

const service_is_healthy: HealthAndReadinessSubsystem = health_and_readiness.addSubsystem({
  name: "global",
  ready: true,
  healthy: true,
})

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  new Edge70MessageProcessor({ health_and_readiness, logger, send_message, event_name })
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
app.get("/ready", health_and_readiness.readiness_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
