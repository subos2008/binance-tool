#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/** Config: */
const quote_asset = "BUSD".toUpperCase()

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "trade-abstraction-service"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

var service_is_healthy: boolean = true

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
import express, { Request, Response } from "express"
import { TradeAbstractionService } from "./trade-abstraction-service"
import { BinanceSpotExecutionEngine } from "./execution-engine"
import { Positions } from "./positions"
import { PositionsPersistance } from "./positions-persistance"
import { RedisPositionsStateAdapter } from "./redis-positions-state-adapter"

process.on("unhandledRejection", (error) => {
  logger.error(error)
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
  send_message(`UnhandledPromiseRejection: ${error}`)
})

var app = express()
var bodyParser = require("body-parser")

app.use(bodyParser.json()) // for parsing application/json
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
) // for parsing application/x-www-form-urlencoded

var app = express()
app.get("/health", function (req: Request, res: Response) {
  if (service_is_healthy) {
    res.send({ status: "OK" })
  } else {
    logger.error(`Service unhealthy`)
    res.status(500).json({ status: "UNHEALTHY" })
  }
})

let tas: TradeAbstractionService
async function main() {
  try {
    const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
    const binance_spot_ee = new BinanceSpotExecutionEngine({ logger })
    const positions_persistance: PositionsPersistance = new RedisPositionsStateAdapter({logger})
    const positions = new Positions({ logger, ee: binance_spot_ee, positions_persistance })
    tas = new TradeAbstractionService({
      positions,
      logger,
      send_message,
      quote_asset /* global */,
    })
    app.get("/positions", function (req: Request, res: Response) {
      res.send(tas.open_positions())
    })
    // await publisher.connect()
  } catch (error) {
    console.error(error)
  }
}

main().catch((error) => {
  console.error(`Error in main loop: ${error}`)
  console.error(error)
  console.error(`Error in main loop: ${error.stack}`)
})
