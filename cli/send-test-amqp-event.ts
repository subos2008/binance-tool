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

let service_name = "cli" // TODO
import { Logger } from "../interfaces/logger"
const LoggerClass = require("../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { GenericPublisher } from "../classes/amqp/generic-publisher"

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
  let pub = new GenericPublisher({ logger, event_name: "InternalConnectivityTestEvent" })
  pub.publish(JSON.stringify({ hello: "world" }))
}
