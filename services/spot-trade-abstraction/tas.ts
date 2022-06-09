#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import "./tracer" // must come before importing any instrumented module.

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

logger.info({ hello: "world" }, "Service starting")

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
  send_message(`UnhandledPromiseRejection: ${err}`)
})

import { StatsD } from "hot-shots"
function dogstatsderrorhandler(err: Error) {
  logger.error({ err }, `DogStatsD: Socket errors caught here: ${err}`)
}

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
import { TradeAbstractionOpenSpotLongCommand, TradeAbstractionOpenSpotLongResult } from "./interfaces/open_spot"
import { TradeAbstractionCloseLongCommand, TradeAbstractionCloseSpotLongResult } from "./interfaces/close_spot"
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
import { SpotPositionsExecution } from "./execution/spot-positions-execution"
import { RedisOrderContextPersistance } from "../../classes/spot/persistence/redis-implementation/redis-order-context-persistence"
import { BinancePriceGetter } from "../../interfaces/exchanges/binance/binance-price-getter"

import { RedisClient } from "redis"
import { AuthorisedEdgeType, check_edge } from "../../classes/spot/abstractions/position-identifier"
import { TradeAbstractionService } from "./trade-abstraction-service"
import { BinanceSpotExecutionEngine } from "./execution/execution_engines/binance-spot-execution-engine"

set_redis_logger(logger)
let redis: RedisClient = get_redis_client()

const order_context_persistence = new RedisOrderContextPersistance({ logger, redis })
const binance_spot_ee = new BinanceSpotExecutionEngine({ logger, order_context_persistence })
const positions_persistance: SpotPositionsPersistance = new RedisSpotPositionsPersistance({ logger, redis })
const position_sizer = new FixedPositionSizer({ logger })
const exchange_identifier = binance_spot_ee.get_exchange_identifier()
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
var dogstatsd = new StatsD({
  errorHandler: dogstatsderrorhandler,
  globalTags: { service_name, exchange_type: exchange_identifier.type, exchange: exchange_identifier.exchange },
  prefix: "trading_engine.tas",
})

try {
  dogstatsd.increment(`.service_started`, 1, 1, function (error, bytes) {
    //this only gets called once after all messages have been sent
    if (error) {
      console.error("Oh noes! There was an error submitting metrics to DogStatsD:", error)
    } else {
      console.log("Successfully sent", bytes, "bytes to DogStatsD")
    }
  })
} catch (e) {
  logger.warn(`Failed to submit metrics to DogStatsD`)
  Sentry.captureException(e)
}

app.get("/positions", async function (req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await tas.open_positions())
  } catch (err) {
    res.status(500)
    next(err)
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
      // TODO: a throw? surely we can improve on this...
      throw new Error(`UnauthorisedEdge: ${edge_unchecked}`)
    }
    let tags: { [name: string]: string } = { edge, base_asset, direction, quote_asset, action }

    let cmd: TradeAbstractionOpenSpotLongCommand = {
      edge,
      direction: "long",
      action: "open",
      base_asset,
      trigger_price,
      signal_timestamp_ms,
    }

    let cmd_received_timestamp_ms = +Date.now()

    try {
      let signal_to_cmd_received_slippage_ms = Number(
        new BigNumber(cmd_received_timestamp_ms).minus(cmd.signal_timestamp_ms).toFixed()
      )
      dogstatsd.distribution(".signal_to_cmd_received_slippage_ms", signal_to_cmd_received_slippage_ms, undefined, tags)
    } catch (err) {
      logger.warn({ ...tags, err }, `Failed to submit metric to DogStatsD`)
      Sentry.captureException(err)
    }

    let result: TradeAbstractionOpenSpotLongResult = await tas.open_spot_long(cmd)
    tags.status = result.status

    try {
      if (result.signal_to_execution_slippage_ms)
        dogstatsd.distribution(
          ".signal_to_execution_slippage_ms",
          Number(result.signal_to_execution_slippage_ms),
          undefined,
          tags
        )
      // Probably being a bit anal with my avoidance of floating point here...
      let execution_time_ms = new BigNumber(result.execution_timestamp_ms || +Date.now())
        .minus(cmd_received_timestamp_ms)
        .toFixed()
      dogstatsd.distribution(".execution_time_ms", Number(execution_time_ms), undefined, tags)
    } catch (err) {
      logger.warn({ ...tags, err }, `Failed to submit metrics to DogStatsD`)
      Sentry.captureException(err)
    }

    let msg: string = `TradeAbstractionOpenSpotLongResult: ${result.edge}:${result.base_asset}: ${result.status}`

    switch (result.status) {
      case "SUCCESS":
        // logger.info(result, msg)
        send_message(
          `${edge}:${base_asset} ${result.status} ${cmd.direction} entry ${result.status} at price ${result.executed_price}, stop at ${result.stop_price}, tp at ${result.take_profit_price}, execution time ${result.signal_to_execution_slippage_ms}ms`,
          tags
        )
        res.status(201).json(result) // 201: Created
        break
      case "ALREADY_IN_POSITION":
        // logger.info(result, msg)
        send_message(`${edge}:${base_asset} ${result.status}`, tags)
        res.status(409).json(result) // 409: Conflict
        break
      case "ABORTED_FAILED_TO_CREATE_EXIT_ORDERS":
        // logger.error(result, msg)
        send_message(`${edge}:${base_asset} ${result.status}`, tags)
        res.status(200).json(result) // 200: Success... but not 201, so not actually created
        break
      case "ENTRY_FAILED_TO_FILL":
        // logger.info(result, msg)
        send_message(`${edge}:${base_asset}: ${result.status}`, tags)
        res.status(200).json(result) // 200: Success... but not 201, so not actually created
        break
      case "UNAUTHORISED":
        // logger.warn(result, msg)
        send_message(`${edge}:${base_asset}: ${result.status}`, tags)
        res.status(403).json(result)
        break
      case "INTERNAL_SERVER_ERROR":
        // logger.error(result, msg)
        send_message(`${edge}:${base_asset}: ${result.status}: ${result.msg}`, tags)
        res.status(500).json(result)
        break
      default:
        msg = `Unrecognised result.status for TradeAbstractionOpenSpotLongResult in TAS: ${(result as any).status}`
        logger.error(result, msg)
        Sentry.captureException(new Error(msg))
        send_message(msg, tags)
        res.status(500).json(result)
    }
  } catch (err: any) {
    if ((err.message = ~/InputChecking/)) {
      res.status(400)
      logger.error(
        `400 due to bad inputs '${req.query.edge}' attempting to open ${req.query.base_asset}: ${err.message}`
      )
      logger.error({ err })
    } else {
      logger.error("Internal error: ${err}")
      logger.error({ err })
      res.status(500)
    }
    res.json({ msg: "failed" })
    next(err)
  }
})

app.get("/spot/close", async function (req: Request, res: Response, next: NextFunction) {
  try {
    let { edge, base_asset, action, direction } = req.query
    let tags: { [name: string]: string } = { edge, base_asset, direction, quote_asset, action } as {
      edge: string
      base_asset: string
      direction: string
      quote_asset: string
      action: string
    }

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
    let result: TradeAbstractionCloseSpotLongResult = await tas.close_spot_long(cmd)
    logger.info(result) // move to log at creation
    res.status(result.http_status).json(result)
  } catch (err) {
    Sentry.captureException(err)
    res.status(500).json({ msg: "internal server error" })
    next(err)
  }
})

// Finally, start our server
// $  npm install -g localtunnel && lt --port 3000
let PORT = 3000
app.listen(PORT, function () {
  logger.debug(`listening on port ${PORT}!`)
})
