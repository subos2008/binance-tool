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
  Sentry.captureException(error)
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
import {
  TradeAbstractionCloseLongCommand,
  TradeAbstractionOpenLongCommand,
  TradeAbstractionService,
} from "./trade-abstraction-service"
import { BinanceSpotExecutionEngine } from "../../classes/spot/exchanges/binance/binance-spot-execution-engine"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import { SpotPositionsPersistance } from "../../classes/spot/persistence/interface/spot-positions-persistance"
import { SpotRedisPositionsState } from "../../classes/spot/persistence/redis-implementation/spot-redis-positions-state-v3"

import express, { NextFunction, Request, Response } from "express"
import { FixedPositionSizer } from "./fixed-position-sizer"
import { RedisInterimSpotPositionsMetaDataPersistantStorage } from "./interim-meta-data-storage"
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

import { get_redis_client, set_redis_logger } from "../../lib/redis"
import { RedisClient } from "redis"
import { SpotPositionsExecution } from "../../classes/spot/execution/spot-positions-execution"
import { RedisOrderContextPersistance } from "../../classes/spot/persistence/redis-implementation/redis-order-context-persistence"
set_redis_logger(logger)
let redis: RedisClient = get_redis_client()

const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
const order_context_persistence = new RedisOrderContextPersistance({ logger, redis })
const binance_spot_ee = new BinanceSpotExecutionEngine({ logger, order_context_persistence })
const positions_persistance: SpotPositionsPersistance = new SpotRedisPositionsState({ logger, redis })
const position_sizer = new FixedPositionSizer({ logger })
const interim_spot_positions_metadata_persistant_storage = new RedisInterimSpotPositionsMetaDataPersistantStorage({
  logger,
  redis,
})
const positions = new SpotPositionsQuery({
  logger,
  positions_persistance,
  send_message,
  interim_spot_positions_metadata_persistant_storage,
  exchange_identifier: binance_spot_ee.get_exchange_identifier(),
})
const spot_ee: SpotPositionsExecution = new SpotPositionsExecution({
  logger,
  position_sizer,
  positions_persistance,
  interim_spot_positions_metadata_persistant_storage,
  ee: binance_spot_ee,
  send_message,
})
let tas: TradeAbstractionService = new TradeAbstractionService({
  positions,
  logger,
  send_message,
  quote_asset /* global */,
  spot_ee,
})
app.get("/positions", async function (req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await tas.open_positions())
  } catch (error) {
    res.status(500)
    next(error)
  }
})

app.get("/spot/long", async function (req: Request, res: Response, next: NextFunction) {
  try {
    let { edge, base_asset, action, direction } = req.query
    assert(edge)
    assert(typeof edge == "string")
    assert(base_asset)
    assert(typeof base_asset == "string")
    assert(direction === "long")
    assert(action === "open")
    let cmd: TradeAbstractionOpenLongCommand = {
      edge,
      direction: "long",
      action: "open",
      base_asset,
    }
    res.status(200).json(await tas.open_spot_long(cmd, send_message))
  } catch (error) {
    res.status(500)
    next(error)
  }
})

app.get("/spot/close", async function (req: Request, res: Response, next: NextFunction) {
  try {
    let { edge, base_asset, action, direction } = req.query
    assert(edge)
    assert(base_asset)
    assert(edge)
    assert(typeof edge == "string")
    assert(base_asset)
    assert(typeof base_asset == "string")
    assert(direction === "long")
    assert(action === "close")
    let cmd: TradeAbstractionCloseLongCommand = {
      edge,
      direction: "long",
      action: "close",
      base_asset,
    }
    res.status(200).json(await tas.close_spot_long(cmd, send_message))
  } catch (error) {
    res.status(500)
    next(error)
  }
})

// Finally, start our server
// $  npm install -g localtunnel && lt --port 3000
app.listen(3000, function () {
  console.log("Telegram app listening on port 3000!")
})
// await publisher.connect()
