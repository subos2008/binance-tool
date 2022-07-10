#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import "./tracer" // must come before importing any instrumented module.

/** Config: */
import { config } from "../../../../config"
const quote_asset = config.binance.spot.tas_quote_asset.toUpperCase()

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "spot-trade-abstraction"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../../../interfaces/logger"
import { Logger as LoggerClass } from "../../../../lib/faux_logger"
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

import { SendMessage, SendMessageFunc } from "../../../../lib/telegram-v2"
import {
  TradeAbstractionOpenSpotLongCommand as TradeAbstractionOpenLongCommand,
  TradeAbstractionOpenSpotLongResult,
} from "./interfaces/open_spot"
import { TradeAbstractionCloseLongCommand, TradeAbstractionCloseSpotLongResult } from "./interfaces/close_spot"

import express, { NextFunction, Request, Response } from "express"
const winston = require("winston")
const expressWinston = require("express-winston")

var app = express()

const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
const health_and_readiness = new HealthAndReadiness({ logger, send_message })
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))

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

import { get_redis_client, set_redis_logger } from "../../../../lib/redis"
import { RedisOrderContextPersistance } from "../../../../classes/persistent_state/redis-implementation/redis-order-context-persistence"

import { RedisClient } from "redis"

import { TradeAbstractionService } from "./trade-abstraction-service"
import { BinanceSpotExecutionEngine as ExecutionEngine } from "./execution/execution_engines/binance-spot-execution-engine"

set_redis_logger(logger)
let redis: RedisClient = get_redis_client()

const order_context_persistence = new RedisOrderContextPersistance({ logger, redis })
const ee = new ExecutionEngine({ logger, order_context_persistence })
const exchange_identifier = ee.get_exchange_identifier()

let tas: TradeAbstractionService = new TradeAbstractionService({
  logger,
  quote_asset /* global */,
  ee,
  send_message,
  redis,
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
      // console.log("Successfully sent", bytes, "bytes to DogStatsD")
    }
  })
} catch (e) {
  logger.warn(`Failed to submit metrics to DogStatsD`)
  Sentry.captureException(e)
}

app.get("/exchange_identifier", async function (req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await tas.get_exchange_identifier())
  } catch (err) {
    res.status(500)
    next(err)
  }
})

app.get("/prices", async function (req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await tas.prices())
  } catch (err) {
    res.status(500)
    next(err)
  }
})

app.get("/positions", async function (req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await tas.open_positions())
  } catch (err) {
    res.status(500)
    next(err)
  }
})

app.get("/long", async function (req: Request, res: Response, next: NextFunction) {
  try {
    let cmd_received_timestamp_ms = +Date.now()

    let { edge, base_asset, trigger_price, signal_timestamp_ms } = req.query
    const direction = "long",
      action = "open"

    try {
      /* input checking */
      assert(typeof edge == "string", new Error(`InputChecking: typeof edge unexpected`))
      assert(
        typeof trigger_price == "string" || typeof trigger_price == "undefined",
        new Error(`InputChecking: typeof trigger_price unexpected: ${typeof trigger_price}`)
      )
      assert(typeof base_asset == "string", new Error(`InputChecking: typeof base_asset unexpected`))
      assert(
        typeof signal_timestamp_ms == "string",
        new Error(`InputChecking: typeof signal_timestamp_ms unexpected: ${typeof signal_timestamp_ms}`)
      )
    } catch (err: any) {
      let spot_long_result: TradeAbstractionOpenSpotLongResult = {
        object_type: "TradeAbstractionOpenSpotLongResult",
        version: 1,
        base_asset: base_asset as string,
        quote_asset,
        edge: edge as string,
        status: "BAD_INPUTS",
        http_status: 400,
        msg: `TradeAbstractionOpenSpotLongResult: ${edge}${base_asset}: BAD_INPUTS`,
        err,
        execution_timestamp_ms: cmd_received_timestamp_ms,
      }
      logger.error(spot_long_result)
      res.status(400).json(spot_long_result)
      logger.error(
        `400 due to bad inputs '${req.query.edge}' attempting to open ${req.query.base_asset}: ${err.message}`
      )
      logger.error({ err })
      return
    }

    let tags: { [name: string]: string } = {
      edge,
      base_asset,
      direction,
      quote_asset,
      action,
      exchange_type: exchange_identifier.type,
    }

    let cmd: TradeAbstractionOpenLongCommand = {
      object_type: "TradeAbstractionOpenLongCommand",
      edge,
      direction,
      action,
      base_asset,
      trigger_price,
      signal_timestamp_ms,
    }

    let result: TradeAbstractionOpenSpotLongResult = await tas.open_spot_long(cmd)
    tags.status = result.status

    try {
      let signal_to_cmd_received_slippage_ms = Number(
        new BigNumber(cmd_received_timestamp_ms).minus(cmd.signal_timestamp_ms).toFixed()
      )
      dogstatsd.distribution(
        ".signal_to_cmd_received_slippage_ms",
        signal_to_cmd_received_slippage_ms,
        undefined,
        tags
      )
    } catch (err) {
      logger.warn({ ...tags, err }, `Failed to submit metric to DogStatsD`)
      Sentry.captureException(err)
    }

    try {
      dogstatsd.increment(".trading_abstraction_open_spot_long_result", tags)
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
        .toFixed(0)
      dogstatsd.distribution(".execution_time_ms", Number(execution_time_ms), undefined, tags)
    } catch (err) {
      logger.warn({ ...tags, err }, `Failed to submit metrics to DogStatsD`)
      Sentry.captureException(err)
    }

    res.status(result.http_status).json(result)

    if (result.status === "SUCCESS") {
      send_message(
        `${edge}:${base_asset} ${result.status} ${cmd.direction} entry ${result.status} at price ${result.executed_price}, stop at ${result.stop_price}, tp at ${result.take_profit_price}, execution time ${result.signal_to_execution_slippage_ms}ms`,
        tags
      )
    } else {
      send_message(`${edge}:${base_asset}: ${result.status}: ${result.msg}`, tags)
    }

    // send_message(result.msg, tags)

    if (result.http_status === 500) {
      let msg: string = `TradeAbstractionOpenSpotLongResult: ${result.edge}:${result.base_asset}: ${result.status}: ${result.msg}`
      logger.error(result, msg)
      Sentry.captureException(new Error(msg))
    }
  } catch (err: any) {
    logger.error("Internal error: ${err}")
    logger.error({ err })
    res.status(500).json({ msg: "Internal Server Error" })
    next(err)
  }
})

app.get("/close", async function (req: Request, res: Response, next: NextFunction) {
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
