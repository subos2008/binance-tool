#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * Event/message listener
 */

import { strict as assert } from "assert"
const service_name = "event-persistance"

import { ListenerFactory } from "../../classes/amqp/all-traffic-topic-exchange-listener-factory"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"

require("dotenv").config()

import Sentry from "../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "./../../lib/faux_logger"
const logger: Logger = new Logger({ silent: false })

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
})

import { MessageProcessor } from "../../classes/amqp/interfaces"

let region = "ap-southeast-1"
import { PutObjectCommand, PutObjectRequest, S3Client } from "@aws-sdk/client-s3"
assert(process.env.AWS_ACCESS_KEY_ID)
assert(process.env.AWS_SECRET_ACCESS_KEY)
const s3Client = new S3Client({ region })
let Bucket = "binance-tool-event-storage"
import { randomUUID } from "crypto"

let listener_factory = new ListenerFactory({ logger })
class EventLogger implements MessageProcessor {
  send_message: Function
  logger: Logger

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
    const amqp_health: HealthAndReadinessSubsystem = health_and_readiness.addSubsystem({
      name: `amqp-listener`,
      ready: false,
      healthy: false,
    })
    listener_factory.build_isolated_listener({
      message_processor: this,
      health_and_readiness: amqp_health,
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

const health_and_readiness = new HealthAndReadiness({ logger, send_message })
const service_is_healthy: HealthAndReadinessSubsystem = health_and_readiness.addSubsystem({
  name: "global",
  ready: true,
  healthy: true,
})

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

import { Channel } from "amqplib"
import express from "express"
var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
