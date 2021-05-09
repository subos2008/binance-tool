#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"
require("dotenv").config()
const connect_options = require("../../lib/amqp/connect_options").default
const service_name = "auto-position-exits"
const routing_key = "binance"

var amqp = require("amqplib/callback_api")

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

const send_message = require("../../lib/telegram.js")(`${service_name}: `)

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

send_message("starting")

process.on("unhandledRejection", (error) => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import Binance from "binance-api-node"
import { ExchangeInfo } from "binance-api-node"

import { PositionsListener } from "../../classes/amqp/positions-listener"
import { NewPositionEvent } from "../../events/position-events"
import { ExchangeEmulator } from "../../lib/exchange_emulator"
import { timeStamp } from "console"

type GenericExchangeInterface = {
  exchangeInfo: () => Promise<ExchangeInfo>
}

export class AutoPositionExits {
  ee: Object
  logger: Logger
  send_message: (msg: string) => void
  positions_listener: PositionsListener

  constructor({ ee, logger, send_message }: { ee: Object; logger: Logger; send_message: (msg: string) => void }) {
    this.ee = ee
    this.logger = logger
    this.send_message = send_message
  }

  async main() {
    if (this.positions_listener) return
    this.positions_listener = new PositionsListener({
      logger: this.logger,
      send_message: this.send_message,
      exchange: routing_key,
      callbacks: this,
    })
    return this.positions_listener.connect()
  }

  async new_position_event_callback(event: NewPositionEvent) {
    this.send_message(`Got a NewPositionEvent!`)
    this.logger.info(event)
  }

  async shutdown_streams() {
    if (this.positions_listener) this.positions_listener.shutdown_streams()
  }
}

var { argv } = require("yargs")
  .usage("Usage: $0 --live")
  .example("$0 --live")
  // '--live'
  .boolean("live")
  .describe("live", "Trade with real money")
  .default("live", false)
let { live } = argv

var auto_position_exits: AutoPositionExits

async function main() {
  var ee: GenericExchangeInterface
  if (live) {
    logger.info("Live monitoring mode")
    if (!process.env.APIKEY) throw new Error(`APIKEY not defined`)
    if (!process.env.APISECRET) throw new Error(`APISECRET not defined`)
    ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET,
      // getTime: xxx // time generator function, optional, defaults to () => Date.now()
    })
  } else {
    logger.info("Emulated trading mode")
    const fs = require("fs")
    const exchange_info = JSON.parse(fs.readFileSync("./test/exchange_info.json", "utf8"))
    let ee_config = {
      starting_balances: {
        USDT: new BigNumber("50"),
      },
      logger,
      exchange_info,
    }
    ee = new ExchangeEmulator(ee_config)
  }

  const execSync = require("child_process").execSync
  execSync("date -u")

  let auto_position_exits = new AutoPositionExits({
    ee,
    send_message,
    logger,
  })

  auto_position_exits.main().catch((error) => {
    Sentry.captureException(error)
    if (error.name && error.name === "FetchError") {
      logger.error(`${error.name}: Likely unable to connect to Binance and/or Telegram: ${error}`)
    } else {
      logger.error(`Error in main loop: ${error}`)
      logger.error(error)
      logger.error(`Error in main loop: ${error.stack}`)
      send_message(`Error in main loop: ${error}`)
    }
    soft_exit(1)
  })
}

main().catch((error) => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`)
  logger.error(error)
  logger.error(`Error in main loop: ${error.stack}`)
  soft_exit(1)
})

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null) {
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`)
  if (exit_code) process.exitCode = exit_code
  if (auto_position_exits) auto_position_exits.shutdown_streams()
  logger.warn(`Do we need to close the Binance object?`)
  // if (redis) redis.quit();
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
