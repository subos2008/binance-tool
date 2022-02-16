#!./node_modules/.bin/ts-node

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({
  dsn: "https://ebe019da62da46189b217c476ec1ab62@o369902.ingest.sentry.io/5326470",
})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "cli")
  scope.setTag("cli", "positions")
})

import { Logger } from "../interfaces/logger"
const LoggerClass = require("../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { GenericTopicPublisher } from "../classes/amqp/generic-publishers"

const yargs = require("yargs")

require("dotenv").config()

async function main() {
  yargs
    .strict()
    .command(["send-test-event", "$0"], "send an internal connectivity test event", {}, send_test_event)
    .help()
    .alias("help", "h").argv
}
main().then(() => {})

async function send_test_event() {
  let pub = new GenericTopicPublisher({ logger, event_name: "InternalConnectivityTestEvent" })
  let object = { hello: "world", object_type: "InternalConnectivityTestEvent" }
  await pub.publish(object)
  await pub.shutdown_streams()
}
