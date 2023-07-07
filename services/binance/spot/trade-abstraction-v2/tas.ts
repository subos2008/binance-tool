#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

// import "./tracer" // must come before importing any instrumented module.

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

import { BunyanServiceLogger } from "../../../../lib/service-logger"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false, level: "debug" })
logger.event({}, { object_class: "event", object_type: "ServiceStarting", msg: "Service starting" })

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { SendMessage } from "../../../../classes/send_message/publish"
import { TradeAbstractionOpenLongCommand, TradeAbstractionOpenLongResult } from "./interfaces/long"
import { TradeAbstractionCloseCommand, TradeAbstractionCloseResult } from "./interfaces/close"
import { get_redis_client } from "../../../../lib/redis-v4"
import { RedisOrderContextPersistence } from "../../../../classes/persistent_state/redis-implementation/redis-order-context-persistence"
import { RedisClientType } from "redis-v4"
import { TradeAbstractionService } from "./trade-abstraction-service"
import { BinanceSpotExecutionEngine as ExecutionEngine } from "./execution/execution_engines/binance-spot-execution-engine"
import { SendMetrics } from "./send-metrics"
import { QueryParamsToCmdMapper } from "./query-params-to-cmd-mapper"
import { SendMessageFunc } from "../../../../interfaces/send-message"

import express, { NextFunction, Request, Response } from "express"
const winston = require("winston")
const expressWinston = require("express-winston")

var app = express()

import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { ServiceLogger } from "../../../../interfaces/logger"
const health_and_readiness = new HealthAndReadiness({ logger })
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const service_is_healthy = health_and_readiness.addSubsystem({
  name: "global",
  healthy: true,
  initialised: false,
})

const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
  service_is_healthy.healthy(false)
})

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

async function main() {
  let redis: RedisClientType = await get_redis_client(logger, health_and_readiness)
  const order_context_persistence = new RedisOrderContextPersistence({ logger, redis })
  const ee = new ExecutionEngine({ logger, order_context_persistence })
  const exchange_identifier = ee.get_exchange_identifier()
  const metrics = new SendMetrics({ service_name, logger, exchange_identifier })

  let tas: TradeAbstractionService = new TradeAbstractionService({
    logger,
    quote_asset /* global */,
    ee,
    send_message,
    redis,
  })

  let mapper = new QueryParamsToCmdMapper({ logger })

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

  // TODO: long is a lot more evolved than close
  app.get("/close", async function (req: Request, res: Response, next: NextFunction): Promise<void> {
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

        try {
          metrics.signal_to_cmd_received_slippage_ms({ tags, signal_timestamp_ms, cmd_received_timestamp_ms })
          metrics.trading_abstraction_close_result({ result: cmd_result, tags, cmd_received_timestamp_ms })
        } catch (err) {
          logger.exception(tags, err)
        }
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

        try {
          metrics.signal_to_cmd_received_slippage_ms({ tags, signal_timestamp_ms, cmd_received_timestamp_ms })
          metrics.trading_abstraction_open_spot_long_result({
            result: cmd_result,
            tags,
            cmd_received_timestamp_ms,
          })
        } catch (err) {
          logger.exception(tags, err)
        }

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
      logger.error({}, `Internal Server Error: ${err}`)
      logger.exception({}, err)
      res.status(500).json({ msg: "Internal Server Error" })
      next(err)
    }
  })

  /**
   * "/short" is equivalent to "/close" for spot exchanges
   *
   */

  try {
    metrics.service_started()
  } catch (err) {
    logger.exception({}, err)
  }
}

main().catch((err) => {
  logger.error(`Error in main loop: ${err}`)
  logger.exception({}, err)
  service_is_healthy.healthy(false)
  throw err
})

// Finally, start our server
// $  npm install -g localtunnel && lt --port 3000
let PORT = 3000
app.listen(PORT, function () {
  logger.debug(`listening on port ${PORT}!`)
  service_is_healthy.initialised(true)
})
