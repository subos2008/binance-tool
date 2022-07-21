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
const quote_asset = config.binance.spot.tas_quote_asset.toUpperCase()

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "spot-trade-abstraction"

import Sentry from "../../../../lib/sentry"
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

import { SendMessage, SendMessageFunc } from "../../../../classes/send_message/publish"
import {
  TradeAbstractionOpenLongCommand as TradeAbstractionOpenLongCommand,
  TradeAbstractionOpenLongResult,
} from "./interfaces/long"
import { TradeAbstractionCloseCommand, TradeAbstractionCloseResult } from "./interfaces/close"

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
import { SendDatadogMetrics } from "./send-datadog-metrics"
import { QueryParamsToCmdMapper } from "./query-params-to-cmd-mapper"

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

let mapper = new QueryParamsToCmdMapper({ logger })

// TODO: long is a lot more evolved than close
app.get("/close", async function (req: Request, res: Response, next: NextFunction) {
  // TODO: use mapper
  try {
    let cmd_received_timestamp_ms = +Date.now()

    let { result: mapper_result, tags } = mapper.close(req, {
      cmd_received_timestamp_ms,
      quote_asset,
      exchange_identifier,
    })

    if (mapper_result.object_type === "TradeAbstractionCloseResult") {
      res.status(mapper_result.http_status).json(mapper_result)
      return
    }

    if (mapper_result.object_type === "TradeAbstractionCloseCommand") {
      let cmd: TradeAbstractionCloseCommand = mapper_result
      let cmd_result: TradeAbstractionCloseResult = await tas.close(cmd)
      tags.status = cmd_result.status

      let { signal_timestamp_ms } = cmd

      metrics.signal_to_cmd_received_slippage_ms({ tags, signal_timestamp_ms, cmd_received_timestamp_ms })
      metrics.trading_abstraction_close_result({ result: cmd_result, tags, cmd_received_timestamp_ms })

      // TODO - 429's for /close
      // if (cmd_result.http_status === 429) {
      //   res.setHeader('Retry-After', cmd_result.retry_after_seconds)
      // }

      res.status(cmd_result.http_status).json(cmd_result)

      send_message(cmd_result.msg, tags)

      if (cmd_result.http_status === 500) {
        let msg: string = `TradeAbstractionCloseResult: ${cmd_result.edge}:${cmd_result.base_asset}: ${cmd_result.status}: ${cmd_result.msg}`
        logger.error(cmd_result, msg) // TODO: Tags?
        Sentry.captureException(new Error(msg)) // TODO: Tags?
      }
      return
    }

    throw new Error(`Unexpected object_type: ${(mapper_result as any).object_type}`)
  } catch (err: any) {
    Sentry.captureException(err)
    logger.error(`Internal Server Error: ${err}`)
    logger.error({ err })
    res.status(500).json({ msg: "Internal Server Error" })
    next(err)
  }
})

app.get("/long", async function (req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let cmd_received_timestamp_ms = +Date.now()

    let { result: mapper_result, tags } = mapper.long(req, {
      cmd_received_timestamp_ms,
      quote_asset,
      exchange_identifier,
    })

    if (mapper_result.object_type === "TradeAbstractionOpenLongResult") {
      res.status(mapper_result.http_status).json(mapper_result)
      return
    }

    if (mapper_result.object_type === "TradeAbstractionOpenLongCommand") {
      let cmd: TradeAbstractionOpenLongCommand = mapper_result
      let cmd_result: TradeAbstractionOpenLongResult = await tas.long(cmd)
      tags.status = cmd_result.status

      let { signal_timestamp_ms } = cmd

      metrics.signal_to_cmd_received_slippage_ms({ tags, signal_timestamp_ms, cmd_received_timestamp_ms })
      metrics.trading_abstraction_open_spot_long_result({ result: cmd_result, tags, cmd_received_timestamp_ms })

      if (cmd_result.http_status === 429) {
        res.setHeader("Retry-After", cmd_result.retry_after_seconds)
      }

      res.status(cmd_result.http_status).json(cmd_result)

      send_message(cmd_result.msg, tags)

      if (cmd_result.http_status === 500) {
        let msg: string = `TradeAbstractionOpenLongResult: ${cmd_result.edge}:${cmd_result.base_asset}: ${cmd_result.status}: ${cmd_result.msg}`
        logger.error(cmd_result, msg) // TODO: Tags?
        Sentry.captureException(new Error(msg)) // TODO: Tags?
      }
      return
    }

    throw new Error(`Unexpected object_type: ${(mapper_result as any).object_type}`)
  } catch (err: any) {
    logger.error(`Internal Server Error: ${err}`)
    logger.error({ err })
    res.status(500).json({ msg: "Internal Server Error" })
    next(err)
  }
})

/**
 * "/short" is equivalent to "/close" for spot exchanges
 *
 */

// Finally, start our server
// $  npm install -g localtunnel && lt --port 3000
let PORT = 3000
app.listen(PORT, function () {
  logger.debug(`listening on port ${PORT}!`)
})
