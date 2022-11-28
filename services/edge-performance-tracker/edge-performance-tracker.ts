#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

/**
 * Event/message listener
 */

import { strict as assert } from "assert"
const service_name = "edge-performance-tracker"

import { Duration } from "luxon"

require("dotenv").config()

import Sentry from "../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Channel, Message } from "amqplib"
import express from "express"
import { SpotPositionClosed } from "../../classes/spot/abstractions/spot-position-callbacks"
import { BigNumber } from "bignumber.js"
import { RedisEdgePerformancePersistence } from "./redis-edge-performance-persistence"
import { get_redis_client } from "../../lib/redis-v4"
import { RedisClientType } from "redis-v4"
import { UploadToMongoDB } from "./upload-for-tableau-via-mongodb"
import { SpotEdgePerformanceEvent } from "./interfaces"
import { SendDatadogMetrics } from "./send-datadog-metrics"
import { SendMessage } from "../../classes/send_message/publish"
import { ContextTags, SendMessageFunc } from "../../interfaces/send-message"
import { TypedMessageProcessor } from "../../classes/amqp/interfaces"
import { TypedListenerFactory } from "../../classes/amqp/listener-factory-v2"
import { ServiceLogger } from "../../interfaces/logger"
import { BunyanServiceLogger } from "../../lib/service-logger"

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

class EventLogger implements TypedMessageProcessor<SpotPositionClosed> {
  event_name: MyEventNameType = "SpotPositionClosed"
  send_message: Function
  logger: ServiceLogger
  health_and_readiness: HealthAndReadiness
  persistence: RedisEdgePerformancePersistence
  mongodb_uploader: UploadToMongoDB
  metrics: SendDatadogMetrics
  constructor({
    send_message,
    logger,
    health_and_readiness,
    persistence,
  }: {
    send_message: SendMessageFunc
    logger: ServiceLogger
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
    this.metrics = new SendDatadogMetrics()
  }

  async start() {
    await this.register_message_processors()
  }

  async register_message_processors() {
    let listener_factory = new TypedListenerFactory({ logger })
    listener_factory.build_listener<SpotPositionClosed>({
      event_name: this.event_name,
      message_processor: this,
      health_and_readiness,
      service_name,
      prefetch_one: false,
      eat_exceptions: false,
    })
  }

  async process_message(i: SpotPositionClosed, channel: Channel, amqp_event: Message): Promise<void> {
    try {
      let tags: ContextTags = i

      channel.ack(amqp_event)

      this.logger.debug(tags, `Ingesting new SpotPositionClosed event for ${i.edge}:${i.base_asset}`)

      let { edge, percentage_quote_change, base_asset, abs_quote_change } = i
      let loss = percentage_quote_change ? percentage_quote_change < 0 : undefined

      let duration = Duration.fromMillis(i.exit_timestamp_ms - i.initial_entry_timestamp_ms)
      let days_in_position = new BigNumber(duration.as("days").toString()).dp(2).toNumber()

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
        days_in_position,
      }

      try {
        let msg: string = `Closed position on ${edge}:${base_asset} with percentage_quote_change of ${
          percentage_quote_change ? new BigNumber(percentage_quote_change.toString()).dp(2).toFixed() : "unknown"
        }%, in position for ${days_in_position} days`
        this.send_message(msg, { edge })
      } catch (e: any) {
        this.logger.error(e)
        Sentry.captureException(e)
      }

      try {
        await this.mongodb_uploader.ingest_event(o)
        this.logger.info(`Uploaded to MongoDB`)
      } catch (e: any) {
        this.logger.error(e)
        Sentry.captureException(e)
      }

      try {
        await this.metrics.ingest_event(o)
        this.logger.info(`Sent as metrics`)
      } catch (e: any) {
        this.logger.error(e)
        Sentry.captureException(e)
      }

      try {
        await this.persistence.ingest_event(i)
        this.logger.info(`Ingested to persistance`)
      } catch (e: any) {
        this.logger.error(e)
        Sentry.captureException(e)
      }
    } catch (err: any) {
      this.logger.error(err)
      Sentry.withScope((scope) => {
        scope.setExtra("amqp_event", amqp_event)
        Sentry.captureException(err)
      })
    }
  }
}

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  let redis: RedisClientType = await get_redis_client(logger, health_and_readiness)

  let persistence = new RedisEdgePerformancePersistence({
    logger,
    redis,
  })

  let foo = new EventLogger({ logger, send_message, health_and_readiness, persistence })
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
  // Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
