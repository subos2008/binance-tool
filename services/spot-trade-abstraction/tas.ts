#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/** Config: */
import { config } from "../../config"
const quote_asset = config.tas_quote_asset.toUpperCase()

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "spot-trade-abstraction"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../interfaces/logger"
import { Logger as LoggerClass } from "../../lib/faux_logger"
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
  TradeAbstractionOpenSpotLongCommand,
  TradeAbstractionOpenSpotLongResult,
  TradeAbstractionService,
} from "./trade-abstraction-service"
import { BinanceSpotExecutionEngine } from "../../classes/spot/exchanges/binance/binance-spot-execution-engine"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import { SpotPositionsPersistance } from "../../classes/spot/persistence/interface/spot-positions-persistance"
import { RedisSpotPositionsPersistance } from "../../classes/spot/persistence/redis-implementation/redis-spot-positions-persistance-v3"

import express, { NextFunction, Request, Response } from "express"
import { FixedPositionSizer } from "./fixed-position-sizer"
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

const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

import { HealthAndReadiness } from "../../classes/health_and_readiness"
const health_and_readiness = new HealthAndReadiness({ logger, send_message })
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))

import { get_redis_client, set_redis_logger } from "../../lib/redis"
import { SpotPositionsExecution } from "../../classes/spot/execution/spot-positions-execution"
import { RedisOrderContextPersistance } from "../../classes/spot/persistence/redis-implementation/redis-order-context-persistence"
import { BinancePriceGetter } from "../../interfaces/exchange/binance/binance-price-getter"

import { RedisClient } from "redis"
import { AuthorisedEdgeType, check_edge } from "../../classes/spot/abstractions/position-identifier"
set_redis_logger(logger)
let redis: RedisClient = get_redis_client()

const order_context_persistence = new RedisOrderContextPersistance({ logger, redis })
const binance_spot_ee = new BinanceSpotExecutionEngine({ logger, order_context_persistence })
const positions_persistance: SpotPositionsPersistance = new RedisSpotPositionsPersistance({ logger, redis })
const position_sizer = new FixedPositionSizer({ logger })
const price_getter = new BinancePriceGetter({
  logger,
  ee: binance_spot_ee.get_raw_binance_ee(),
  cache_timeout_ms: 400,
})
const positions = new SpotPositionsQuery({
  logger,
  positions_persistance,
  send_message,
  exchange_identifier: binance_spot_ee.get_exchange_identifier(),
})
const spot_ee: SpotPositionsExecution = new SpotPositionsExecution({
  logger,
  position_sizer,
  positions_persistance,
  ee: binance_spot_ee,
  send_message,
  price_getter,
})
let tas: TradeAbstractionService = new TradeAbstractionService({
  positions,
  logger,
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
    let { edge: edge_unchecked, base_asset, action, direction, trigger_price, signal_timestamp_ms } = req.query

    /* input checking */
    assert(typeof edge_unchecked == "string", new Error(`InputChecking: typeof edge unexpected`))
    assert(
      typeof trigger_price == "string" || typeof trigger_price == "undefined",
      new Error(`InputChecking: typeof trigger_price unexpected: ${typeof trigger_price}`)
    )
    assert(typeof base_asset == "string", new Error(`InputChecking: typeof base_asset unexpected`))
    assert(
      typeof signal_timestamp_ms == "string",
      new Error(`InputChecking: typeof signal_timestamp_ms unexpected: ${typeof signal_timestamp_ms}`)
    )
    assert(direction === "long", new Error(`InputChecking: expected long direction`))
    assert(action === "open", new Error(`InputChecking: expected action to be open`))

    let edge: AuthorisedEdgeType
    try {
      edge = check_edge(edge_unchecked)
    } catch (err) {
      throw new Error(`UnauthorisedEdge: ${edge_unchecked}`)
    }
    let cmd: TradeAbstractionOpenSpotLongCommand = {
      edge,
      direction: "long",
      action: "open",
      base_asset,
      trigger_price,
      signal_timestamp_ms,
    }
    let result: TradeAbstractionOpenSpotLongResult = await tas.open_spot_long(cmd)

    switch (result.status) {
      case "SUCCESS":
        send_message(
          `${edge}:${base_asset} ${result.status} ${cmd.direction} entry ${result.status} at price ${result.executed_price}, stop at ${result.stop_price}, tp at ${result.take_profit_price}, execution time ${result.execution_time_slippage_ms}ms`,
          { edge, base_asset }
        )
        res.status(201).json(result) // 201: Created
        break
      case "ALREADY_IN_POSITION":
        send_message(`${edge}:${base_asset} ${result.status}`, { edge, base_asset })
        res.status(409).json(result) // 409: Conflict
        break
      case "ABORTED_FAILED_TO_CREATE_EXIT_ORDERS":
        send_message(`${edge}:${base_asset} ${result.status}`, { edge, base_asset })
        res.status(200).json(result) // 200: Success... but not 201, so not actually created
        break
      case "ENTRY_FAILED_TO_FILL":
        send_message(`${edge}:${base_asset}: ${result.status}`, { edge, base_asset })
        res.status(200).json(result) // 200: Success... but not 201, so not actually created
        break
      case "UNAUTHORISED":
        send_message(`${edge}:${base_asset}: ${result.status}`, { edge, base_asset })
        res.status(403).json(result)
        break
      default:
        let msg = `Unrecognised result.status for TradeAbstractionOpenSpotLongResult in TAS: ${result.status}`
        logger.error(msg)
        Sentry.captureException(new Error(msg))
        send_message(msg)
    }
  } catch (error: any) {
    if ((error.message = ~/InputChecking/)) {
      res.status(400)
      logger.warn(
        `400 due to bad inputs '${req.query.edge}' attempting to open ${req.query.base_asset}: ${error.message}`
      )
    } else {
      res.status(500)
    }
    res.json({ msg: "failed" })
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
    let json = await tas.close_spot_long(cmd)
    logger.info(`Success`)
    logger.info(json)
    res.status(200).json({ msg: "success" })
  } catch (error) {
    res.status(500).json({ msg: "failed" })
    next(error)
  }
})

// Finally, start our server
// $  npm install -g localtunnel && lt --port 3000
let PORT = 3000
app.listen(PORT, function () {
  logger.debug(`listening on port ${PORT}!`)
})
