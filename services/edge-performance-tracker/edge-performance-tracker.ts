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
import express from "express"
import { SpotPositionClosedEvent_V1 } from "../../classes/spot/abstractions/spot-position-publisher"
import { BigNumber } from "bignumber.js"
import { RedisEdgePerformancePersistence } from "./redis-edge-performance-persistence"
import { get_redis_client } from "../../lib/redis-v4"
import { RedisClientType } from "redis-v4"
import { UploadToMongoDB } from "./upload-for-tableau-via-mongodb"
import { SpotEdgePerformanceEvent } from "./interfaces"
const health_and_readiness = new HealthAndReadiness({ logger, send_message })
const service_is_healthy = health_and_readiness.addSubsystem({ name: "global", ready: true, healthy: true })

class EventLogger implements MessageProcessor {
  send_message: Function
  logger: Logger
  health_and_readiness: HealthAndReadiness
  persistence: RedisEdgePerformancePersistence
  mongodb_uploader: UploadToMongoDB

  constructor({
    send_message,
    logger,
    health_and_readiness,
    persistence,
  }: {
    send_message: SendMessageFunc
    logger: Logger
    health_and_readiness: HealthAndReadiness
    persistence: RedisEdgePerformancePersistence
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.health_and_readiness = health_and_readiness
    this.persistence = persistence
    this.mongodb_uploader = new UploadToMongoDB()
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
    try {
      this.logger.info(amqp_event.content.toString())

      channel.ack(amqp_event)

      let i: SpotPositionClosedEvent_V1 = JSON.parse(amqp_event.content.toString())
      this.logger.info(JSON.stringify(i))

      let { edge, percentage_quote_change, base_asset, abs_quote_change } = i
      let loss = percentage_quote_change ? percentage_quote_change < 0 : undefined
      let o: SpotEdgePerformanceEvent = {
        object_type: "SpotEdgePerformanceEvent",
        version: 1,
        edge,
        percentage_quote_change,
        abs_quote_change,
        loss,
        base_asset,
        exchange: i.exchange_identifier.exchange,
        exchange_type: i.exchange_identifier.type,
        entry_timestamp_ms: i.initial_entry_timestamp_ms,
        exit_timestamp_ms: i.exit_timestamp_ms,
      }

      try {
        let msg: string = `Closed position on ${edge}:${base_asset} with percentage_quote_change of ${
          percentage_quote_change ? new BigNumber(percentage_quote_change).dp(2).toFixed() : "unknown"
        }%`
        this.send_message(msg, { edge })
      } catch (e) {
        this.logger.error(e)
        Sentry.captureException(e)
      }

      try {
        this.mongodb_uploader.ingest_event(o)
      } catch (e) {
        this.logger.error(e)
        Sentry.captureException(e)
      }

      try {
        this.persistence.ingest_event(i)
      } catch (e) {
        this.logger.error(e)
        Sentry.captureException(e)
      }
    } catch (e) {
      this.logger.error(e)
      Sentry.captureException(e)
    }
  }
}

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  const redis_health_and_readiness = health_and_readiness.addSubsystem({
    name: "redis",
    ready: false,
    healthy: false,
  })

  let redis: RedisClientType = await get_redis_client(logger, redis_health_and_readiness)

  let persistence = new RedisEdgePerformancePersistence({
    logger,
    redis,
  })

  let foo = new EventLogger({ logger, send_message, health_and_readiness, persistence })
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
  // Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
app.get("/ready", health_and_readiness.readiness_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
