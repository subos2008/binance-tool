#!./node_modules/.bin/ts-node

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import Sentry from "../../lib/sentry"

import { strict as assert } from "assert"
import express from "express"
import { get_redis_client, set_redis_logger } from "../../lib/redis"
import { RedisClient } from "redis"
import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { ExchangeIdentifier_V4, ei_v4_to_v3 } from "../../events/shared/exchange-identifier"
import { SendMessageFunc } from "../../interfaces/send-message"
import { BunyanServiceLogger } from "../../lib/service-logger"
import { ServiceLogger } from "../../interfaces/logger"
// import { SendMessage } from "../../classes/send_message/publish"
import binance from "binance-api-node"
import { Binance } from "binance-api-node"
import { PortfolioVsPositions } from "./portfolio-vs-positions"
import { RedisSpotPositionsPersistence } from "../../classes/spot/persistence/redis-implementation/redis-spot-positions-persistance-v3"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import { BinancePriceGetter } from "../../interfaces/exchanges/binance/binance-price-getter"
import { SendMessage } from "../../classes/send_message/publish"

/** Config: */
const service_name = "portfolio-vs-positions"
require("dotenv").config()
const quote_asset = "BUSD"
const max_quote_amount_drift_allowed = new BigNumber("1")
let run_interval_seconds = 60 * 60 * 4
const base_asset_ignore_list = ["BNB", "AGI"] // Assets we expect mismatches on

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false, level: "debug" })
logger.event({}, { object_type: "ServiceStarting" })

const health_and_readiness = new HealthAndReadiness({ logger })
// const send_message: SendMessageFunc = (s) => console.log(s) //new SendMessage({ service_name, logger, health_and_readiness }).build()
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
const service_is_healthy = health_and_readiness.addSubsystem({
  name: "global",
  healthy: true,
  initialised: false,
})

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
  service_is_healthy.healthy(false)
})

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)

async function main() {
  assert(process.env.BINANCE_API_KEY)
  assert(process.env.BINANCE_API_SECRET)
  var ee: Binance = binance({
    apiKey: process.env.BINANCE_API_KEY || "foo",
    apiSecret: process.env.BINANCE_API_SECRET || "foo",
  })
  let exchange_identifier: ExchangeIdentifier_V4 = { version: 4, exchange: "binance", exchange_type: "spot" }

  try {
    let redis: RedisClient = get_redis_client()
    set_redis_logger(logger)
    let positions_persistance = new RedisSpotPositionsPersistence({ logger, redis })
    let spot_positions_query = new SpotPositionsQuery({
      logger,
      positions_persistance,
      send_message,
      exchange_identifier: ei_v4_to_v3(exchange_identifier),
    })
    let prices_getter = new BinancePriceGetter({ logger, ee })
    let service = new PortfolioVsPositions({
      ee,
      logger,
      send_message,
      health_and_readiness,
      spot_positions_query,
      redis,
      quote_asset,
      prices_getter,
      max_quote_amount_drift_allowed,
      base_asset_ignore_list,
    })
    let run: () => void = () => {
      service.run_once({ quote_asset }).catch((err) => {
        logger.exception({}, err)
        service_is_healthy.healthy(false)
      })
    }
    run()
    setInterval(run, run_interval_seconds * 1000)
    service_is_healthy.initialised(true)
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
