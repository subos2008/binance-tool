#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/** Config: */
const quote_asset = "BUSD".toUpperCase()

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "spot-trade-abstraction"

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

process.on("unhandledRejection", (error) => {
  logger.error(error)
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
import { TradeAbstractionService } from "./trade-abstraction-service"
import { BinanceSpotExecutionEngine } from "./execution-engine"
import { SpotPositions } from "./spot-positions"
import { SpotPositionsPersistance } from "./spot-positions-persistance"
import { SpotRedisPositionsStateAdapter } from "./redis-positions-state-adapter"

import express, { Request, Response } from "express"
const winston = require("winston")
const expressWinston = require("express-winston")

var app = express()

app.use(
  expressWinston.logger({
    transports: [new winston.transports.Console()],
    format: winston.format.combine(winston.format.colorize(), winston.format.json()),
    meta: true, // optional: control whether you want to log the meta data about the request (default to true)
    msg: "HTTP {{req.method}} {{req.url}}", // optional: customize the default logging message. E.g. "{{res.statusCode}} {{req.method}} {{res.responseTime}}ms {{req.url}}"
    expressFormat: true, // Use the default Express/morgan request formatting. Enabling this will override any msg if true. Will only output colors with colorize set to true
    colorize: false, // Color the text and status code, using the Express/morgan color palette (text: gray, status: default green, 3XX cyan, 4XX yellow, 5XX red).
    ignoreRoute: function (req: Request, res: Response) {
      return req.path == "/health"
    }, // optional: allows to skip some log messages based on request and/or response
  })
)

var bodyParser = require("body-parser")

app.use(bodyParser.json()) // for parsing application/json
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
) // for parsing application/x-www-form-urlencoded

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
    const positions_persistance: SpotPositionsPersistance = new SpotRedisPositionsStateAdapter({ logger })
    const positions = new SpotPositions({ logger, ee: binance_spot_ee, positions_persistance })
    tas = new TradeAbstractionService({
      positions,
      logger,
      send_message,
      quote_asset /* global */,
    })
    app.get("/positions", async function (req: Request, res: Response) {
      res.json(await tas.open_positions())
    })
    // Finally, start our server
    // $  npm install -g localtunnel && lt --port 3000
    app.listen(3000, function () {
      console.log("Telegram app listening on port 3000!")
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
