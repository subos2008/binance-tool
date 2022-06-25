#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

// OG message format:

// We should be sending the msg from the cmd_result really
// if (cmd_result.status === "SUCCESS") {
//   send_message(
//     `${edge}:${base_asset} ${cmd_result.status} ${cmd.direction} entry ${cmd_result.status} at price ${cmd_result.executed_price}, stop at ${cmd_result.stop_price}, tp at ${cmd_result.take_profit_price}, execution time ${cmd_result.signal_to_execution_slippage_ms}ms`,
//     tags
//   )
// } else {
//   send_message(`${edge}:${base_asset}: ${cmd_result.status}: ${cmd_result.msg}`, tags)
// }

import "./tracer" // must come before importing any instrumented module.

/** Config: */
import { config } from "../../../../config"
const quote_asset = config.tas_quote_asset.toUpperCase()

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
import { RedisOrderContextPersistance } from "../../../../classes/spot/persistence/redis-implementation/redis-order-context-persistence"

import { RedisClient } from "redis"

import { TradeAbstractionService } from "./trade-abstraction-service"
import { BinanceSpotExecutionEngine as ExecutionEngine } from "./execution/execution_engines/binance-spot-execution-engine"
import { SendDatadogMetrics } from "./send-datadog-metrics"
import { QueryParamsToCmd } from "./query-params-to-cmd"

set_redis_logger(logger)
let redis: RedisClient = get_redis_client()

const order_context_persistence = new RedisOrderContextPersistance({ logger, redis })
const ee = new ExecutionEngine({ logger, order_context_persistence })
const exchange_identifier = ee.get_exchange_identifier()

const metrics = new SendDatadogMetrics({ service_name, logger, exchange_identifier })

let tas: TradeAbstractionService = new TradeAbstractionService({
  logger,
  quote_asset /* global */,
  ee,
  send_message,
  redis,
})

metrics.service_started()

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

let mapper = new QueryParamsToCmd({ logger })

app.get("/long", async function (req: Request, res: Response, next: NextFunction) {
  try {
    let cmd_received_timestamp_ms = +Date.now()

    let { result: mapper_result, tags } = mapper.long(req, {
      cmd_received_timestamp_ms,
      quote_asset,
      exchange_identifier,
    })

    if (mapper_result.object_type === "TradeAbstractionOpenSpotLongResult") {
      res.status(mapper_result.http_status).json(mapper_result)
      return
    }

    if ((mapper_result.object_type as any) !== "TradeAbstractionOpenLongCommand") {
      throw new Error(`Unexpected object_type: ${mapper_result.object_type}`)
    }

    let cmd: TradeAbstractionOpenLongCommand = mapper_result
    let cmd_result: TradeAbstractionOpenSpotLongResult = await tas.open_spot_long(cmd)
    tags.status = cmd_result.status

    let { signal_timestamp_ms } = cmd

    metrics.signal_to_cmd_received_slippage_ms({ tags, signal_timestamp_ms, cmd_received_timestamp_ms })
    metrics.trading_abstraction_open_spot_long_result({ result: cmd_result, tags, cmd_received_timestamp_ms })

    res.status(cmd_result.http_status).json(cmd_result)

    send_message(cmd_result.msg, tags)

    if (cmd_result.http_status === 500) {
      let msg: string = `TradeAbstractionOpenSpotLongResult: ${cmd_result.edge}:${cmd_result.base_asset}: ${cmd_result.status}: ${cmd_result.msg}`
      logger.error(cmd_result, msg) // TODO: Tags?
      Sentry.captureException(new Error(msg)) // TODO: Tags?
    }
  } catch (err: any) {
    logger.error("Internal Server Error: ${err}")
    logger.error({ err })
    res.status(500).json({ msg: "Internal Server Error" })
    next(err)
  }
})

// TODO: long is a lot more evolved than close
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
    let cmd_result: TradeAbstractionCloseSpotLongResult = await tas.close_spot_long(cmd)
    logger.info(cmd_result) // move to log at creation
    res.status(cmd_result.http_status).json(cmd_result)
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
