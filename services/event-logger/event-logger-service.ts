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

var service_is_healthy: boolean = true

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

process.on("unhandledRejection", (error) => {
  logger.error(error)
  Sentry.captureException(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import { MessageProcessor } from "../../classes/amqp/interfaces"

let region = "ap-southeast-1"
import { PutObjectCommand, PutObjectRequest, S3Client } from "@aws-sdk/client-s3"
assert(process.env.AWS_ACCESS_KEY_ID)
assert(process.env.AWS_SECRET_ACCESS_KEY)
const s3Client = new S3Client({ region })
let Bucket = "binance-tool-event-storage"

let listener_factory = new ListenerFactory({ logger })
class EventLogger implements MessageProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType

  constructor({
    send_message,
    logger,
    event_name,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    event_name: MyEventNameType
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.event_name = event_name
    listener_factory.build_isolated_listener({ event_name, message_processor: this }) // Add arbitrary data argument
  }

  async process_message(event: any, channel: Channel) {
    try {
      this.logger.info(event)
      let Body = event.content.toString()
      let Key = `${this.event_name}/${+new Date()}` // ms timestamp
      let params: PutObjectRequest = { Bucket, Key, Body }
      const results = await s3Client.send(new PutObjectCommand(params))
      console.log("Successfully created " + params.Key + " and uploaded it to " + params.Bucket + "/" + params.Key)
      channel.ack(event)
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error(err)
    }
  }
}

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  new EventLogger({ logger, send_message, event_name: "SpotBinancePortfolio" })
  new EventLogger({ logger, send_message, event_name: "Edge56EntrySignal" })
  new EventLogger({ logger, send_message, event_name: "Edge60EntrySignal" })
  new EventLogger({ logger, send_message, event_name: "SpotBinanceOrder" })
  new EventLogger({ logger, send_message, event_name: "SpotPositionOpened" })
  new EventLogger({ logger, send_message, event_name: "SpotPositionClosed" })
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
  service_is_healthy = false // it seems service isn't exiting on soft exit, but add this to make sure
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) process.exitCode = exit_code
  Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Channel } from "amqplib"
import express, { Request, Response } from "express"
var app = express()
app.get("/health", function (req: Request, res: Response) {
  if (service_is_healthy) {
    res.send({ status: "OK" })
  } else {
    logger.error(`Service unhealthy`)
    res.status(500).json({ status: "UNHEALTHY" })
  }
})
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
