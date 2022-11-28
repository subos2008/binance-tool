#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

import "./tracer" // must come before importing any instrumented module.

/**
 * Event/message listener
 */

/* config */
const service_name = "edge70-signal-to-tas-bridge"
const event_name: MyEventNameType = "Edge70Signal"

require("dotenv").config()

import { strict as assert } from "assert"
import express from "express"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Channel, Message } from "amqplib"
import { SendMessage } from "../../classes/send_message/publish"
import { Edge70SignalProcessor } from "./interfaces"

import Sentry from "../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { ContextTags, SendMessageFunc } from "../../interfaces/send-message"
import { Edge70Signal } from "../edge70-signals/interfaces/edge70-signal"
import { Edge70SignalFanout } from "./fanout"
import { TypedListenerFactory } from "../../classes/amqp/listener-factory-v2"
import { ServiceLogger } from "../../interfaces/logger"
import { BunyanServiceLogger } from "../../lib/service-logger"
import { TypedMessageProcessor } from "../../classes/amqp/interfaces"

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

let listener_factory = new TypedListenerFactory({ logger })

class Edge70MessageProcessor implements TypedMessageProcessor<Edge70Signal> {
  send_message: Function
  logger: ServiceLogger
  event_name: MyEventNameType
  fanout: Edge70SignalProcessor

  constructor({
    send_message,
    logger,
    event_name,
    health_and_readiness,
  }: {
    send_message: (msg: string) => void
    logger: ServiceLogger
    event_name: MyEventNameType
    health_and_readiness: HealthAndReadiness
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.event_name = event_name
    this.fanout = new Edge70SignalFanout({ logger, event_name, send_message })
    listener_factory.build_listener<Edge70Signal>({
      event_name,
      message_processor: this,
      health_and_readiness,
      prefetch_one: false,
      service_name,
      eat_exceptions: false,
    })
  }

  async process_message(signal: Edge70Signal, channel: Channel, amqp_message: Message) {
    let tags: ContextTags = signal
    try {
      this.logger.object(tags, signal)

      // TODO: move this lower when the TAS is refactored
      channel.ack(amqp_message)

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
      this.logger.exception(tags, err)
    }
  }
}

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
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
