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

const send_message = require("../../lib/telegram.js")(`${service_name}: `)

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

process.on("unhandledRejection", (error) => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import { MessageProcessor } from "../../classes/amqp/interfaces"

let region = "ap-southeast-1"
import { PutObjectCommand, PutObjectRequest, S3Client } from "@aws-sdk/client-s3"
assert(process.env.AWS_ACCESS_KEY_ID)
assert(process.env.AWS_SECRET_ACCESS_KEY)
const s3Client = new S3Client({ region })
let Bucket = "binance-tool-event-storage"
let event_name: MyEventNameType = "SpotBinancePortfolio"

class EventLogger implements MessageProcessor {
  send_message: Function
  logger: Logger

  constructor({ send_message, logger }: { send_message: (msg: string) => void; logger: Logger }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
  }

  async start() {
    await this.register_message_processors()
  }

  async register_message_processors() {
    let listener_factory = new ListenerFactory({ logger })
    listener_factory.build_isolated_listener({ event_name, message_processor: this })
  }

  async process_message(event: any) {
    try {
      this.logger.info(event)
      let Body = event.content.toString()
      let Key = `${event_name}/${+new Date()}` // ms timestamp
      let params: PutObjectRequest = { Bucket, Key, Body }
      const results = await s3Client.send(new PutObjectCommand(params))
      console.log("Successfully created " + params.Key + " and uploaded it to " + params.Bucket + "/" + params.Key)
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error(err)
    }
  }
}

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  let foo = new EventLogger({ logger, send_message })
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
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) process.exitCode = exit_code
  service_is_healthy = false // it seems service isn't exiting on soft exit, but add this to make sure
  Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

import * as express from "express"
import { MyEventNameType } from "../../classes/amqp/message-routing"
var app = express()
app.get("/health", function (req, res) {
  if (service_is_healthy) res.send({ status: "OK" })
  else res.status(500).json({ status: "UNHEALTHY" })
})
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
