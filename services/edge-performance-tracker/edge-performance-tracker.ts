#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * Event/message listener
 */

import { strict as assert } from "assert"
const service_name = "edge-performance-tracker"

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

import { MessageProcessor } from "../../classes/amqp/interfaces"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Channel } from "amqplib"

const health_and_readiness = new HealthAndReadiness({ logger, send_message })
const service_is_healthy = health_and_readiness.addSubsystem({ name: "global", ready: true, healthy: true })

class EventLogger implements MessageProcessor {
  send_message: Function
  logger: Logger
  health_and_readiness: HealthAndReadiness

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
  }

  async start() {
    await this.register_message_processors()
  }

  async register_message_processors() {
    let listener_factory = new ListenerFactory({ logger })
    let event_name: MyEventNameType = "SpotPositionClosed"
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

  async process_message(amqp_event: any, channel: Channel): Promise<void> {
    this.logger.info(amqp_event.content.toString())

    try {
      let event: SpotPositionClosedEvent_V1 = JSON.parse(amqp_event.content.toString())
      this.logger.info(JSON.stringify(event))
      channel.ack(amqp_event)

      /**
       * export interface SpotPositionClosedEvent_V1 extends _shared_v1 {
          object_type: "SpotPositionClosed"
          object_subtype: "SingleEntryExit" // simple trades with one entry order and one exit order
          version: 1

          When the exit signal fired 
          exit_signal_source?: string // bert, service name etc
          exit_signal_timestamp_ms?: number
          exit_signal_price_at_signal?: string

        Executed exit 
          exit_timestamp_ms: number
          exit_executed_price: string // average exit price (actual)
          exit_quote_asset: string // should match initial_entry_quote_asset

          can be added if quote value was calculated or the same for all orders  
          exit_quote_returned: string // how much quote did we get when liquidating the position
          exit_position_size: string // base asset

          total_quote_invested: string // same as initial_entry_quote_invested
          total_quote_returned: string // same as exit_quote_returned

          percentage_quote_change: number // use a float for this, it's not for real accounting

  edge: AuthorisedEdgeType

  entry_signal_source?: string // bert, service name etc
  entry_signal_timestamp_ms?: number
  entry_signal_price_at_signal?: string

  initial_entry_timestamp_ms: number
  initial_entry_executed_price: string // average entry price (actual)
  initial_entry_quote_asset: string

  initial_entry_quote_invested: string
  initial_entry_position_size: string // base asset

  orders: GenericOrderData[]
  */
      let { edge, percentage_quote_change, base_asset } = event
      let msg: string = `Closed position on ${edge}:${base_asset} with percentage_quote_change of ${
        percentage_quote_change ? new BigNumber(percentage_quote_change).dp(2).toFixed() : "unknown"
      }%`
      this.send_message(msg)
    } catch (e) {
      console.log(e)
      Sentry.captureException(e)
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
import { SpotPositionClosedEvent_V1 } from "../../classes/spot/abstractions/spot-position-publisher"
import { BigNumber } from "bignumber.js"
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
