#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

/**
 * Event/message listener
 */

import { strict as assert } from "assert"
const service_name = "event-persistance"

require("dotenv").config()

import Sentry from "../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { AllTrafficTopicExchangeListenerFactory } from "../../classes/amqp/all-traffic-topic-exchange-listener-factory"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { SendMessage } from "../../classes/send_message/publish"
import { Channel } from "amqplib"
import { SendMessageFunc } from "../../interfaces/send-message"
import express from "express"
import { RawAMQPMessageProcessor } from "../../classes/amqp/interfaces"
import { randomUUID } from "crypto"
import { ServiceLogger } from "../../interfaces/logger"
import { BunyanServiceLogger } from "../../lib/service-logger"
import { PutObjectCommand, PutObjectRequest, S3Client } from "@aws-sdk/client-s3"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_type: "ServiceStarting" })

const health_and_readiness = new HealthAndReadiness({ logger })
const service_is_healthy = health_and_readiness.addSubsystem({
  name: "global",
  healthy: true,
  initialised: true,
})
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
  service_is_healthy.healthy(false)
})

let region = "ap-southeast-1"
assert(process.env.AWS_ACCESS_KEY_ID)
assert(process.env.AWS_SECRET_ACCESS_KEY)
const s3Client = new S3Client({ region })
let Bucket = "binance-tool-event-storage"

let listener_factory = new AllTrafficTopicExchangeListenerFactory({ logger })
class EventLogger implements RawAMQPMessageProcessor {
  send_message: Function
  logger: ServiceLogger

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
    listener_factory.build_isolated_listener({
      message_processor: this,
      health_and_readiness,
      service_name,
    }) // Add arbitrary data argument
  }

  async process_message(event: any, channel: Channel) {
    try {
      this.logger.info(event)
      let Body = event.content.toString()
      let event_object = JSON.parse(Body)
      let event_name = event_object.object_type || "Orphaned"
      let Key = `${event_name}/${+new Date()}-${randomUUID()}.json` // ms timestamp
      let params: PutObjectRequest = { Bucket, Key, Body }
      const results = await s3Client.send(new PutObjectCommand(params))
      console.log("Successfully created " + params.Key + " and uploaded it to " + params.Bucket + "/" + params.Key)
      channel.ack(event)
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err })
    }
  }
}

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  new EventLogger({ health_and_readiness, logger, send_message })
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
