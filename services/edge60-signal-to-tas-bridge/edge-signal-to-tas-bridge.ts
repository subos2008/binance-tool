#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * Event/message listener
 */

import { strict as assert } from "assert"
const service_name = "edge-signal-to-tas-bridge"
require("dotenv").config()

import { ListenerFactory } from "../../classes/amqp/listener-factory"
import { SpotTradeAbstractionServiceClient } from "../spot-trade-abstraction/client/tas-client"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { MessageProcessor } from "../../classes/amqp/interfaces"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Channel } from "amqplib"
import express, { Request, Response } from "express"
import { Edge60PositionEntrySignal } from "../../events/shared/edge60-position-entry"
import { Edge60EntrySignalFanout, Edge60EntrySignalProcessor } from "./on-edge60-signal"
import * as Sentry from "@sentry/node"
import { Logger } from "../../interfaces/logger"
import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"

Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

process.on("unhandledRejection", (error) => {
  logger.error(error)
  Sentry.captureException(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

const TAS_URL = process.env.SPOT_TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("SPOT_TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}

let listener_factory = new ListenerFactory({ logger })

class Edge60MessageProcessor implements MessageProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType
  tas_client: SpotTradeAbstractionServiceClient
  processor: Edge60EntrySignalProcessor

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
    this.tas_client = new SpotTradeAbstractionServiceClient({ logger })
    this.event_name = event_name
    this.processor = new Edge60EntrySignalFanout({ logger, event_name, send_message })
    const amqp_health: HealthAndReadinessSubsystem = health_and_readiness.addSubsystem({
      name: `amqp-listener-${event_name}`,
      ready: true,
      healthy: true,
    })
    listener_factory.build_isolated_listener({
      event_name,
      message_processor: this,
      health_and_readiness: amqp_health,
    }) // Add arbitrary data argument
  }

  async process_message(event: any, channel: Channel) {
    try {
      this.logger.info(event)
      channel.ack(event)

      let Body = event.content.toString()
      this.logger.info(`Message Received: ${Body}`)
      let signal: Edge60PositionEntrySignal = JSON.parse(Body)
      assert.equal(signal.version, "v1")
      assert.equal(signal.object_type, "Edge60EntrySignal")
      let { base_asset } = signal.market_identifier
      let { edge } = signal
      assert.equal(edge, "edge60")

      if (!base_asset) {
        throw new Error(
          `base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`
        )
      }
      this.processor.process_edge60_entry_signal(signal)
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error(err)
    }
  }
}

const health_and_readiness = new HealthAndReadiness({ logger, send_message })
const service_is_healthy: HealthAndReadinessSubsystem = health_and_readiness.addSubsystem({
  name: "global",
  ready: true,
  healthy: true,
})

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  new Edge60MessageProcessor({ health_and_readiness, logger, send_message, event_name: "Edge60EntrySignal" })
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
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) process.exitCode = exit_code
  Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

var app = express()
app.get("/health", function (req: Request, res: Response) {
  if (service_is_healthy.healthy()) {
    res.send({ status: "OK" })
  } else {
    logger.error(`Service unhealthy`)
    res.status(500).json({ status: "UNHEALTHY" })
  }
})
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)