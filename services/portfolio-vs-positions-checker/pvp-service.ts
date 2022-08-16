#!./node_modules/.bin/ts-node

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { strict as assert } from "assert"
import express, { Request, Response } from "express"
import { BinanceExchangeInfoGetter } from "../../classes/exchanges/binance/exchange-info-getter"
import { get_redis_client } from "../../lib/redis-v4"
import { RedisClientType } from "redis-v4"
import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { ExchangeIdentifier_V4 } from "../../events/shared/exchange-identifier"
import { SendMessageFunc } from "../../interfaces/send-message"
import { BunyanServiceLogger } from "../../lib/service-logger"
import { ServiceLogger } from "../../interfaces/logger"
import { SendMessage } from "../../classes/send_message/publish"
import binance from "binance-api-node"
import { Binance } from "binance-api-node"
import { PortfolioVsPositions } from "./portfolio-vs-positions"

/** Config: */
const service_name = "portfolo-vs-positions"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false, level: "debug" })

process.on("unhandledRejection", (err) => {
  logger.exception({}, err)
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
  send_message(`UnhandledPromiseRejection: ${err} - not setting global_health to false`)
})

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
const global_health = health_and_readiness.addSubsystem({ name: "global", ready: false, healthy: true })

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
app.get("/ready", health_and_readiness.readiness_handler.bind(health_and_readiness))
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
    const redis_health = health_and_readiness.addSubsystem({ name: "redis", ready: false, healthy: false })
    let redis: RedisClientType = await get_redis_client(logger, redis_health)

    // let service = new PortfolioVsPositions({
    //   ee,
    //   exchange_identifier,
    //   logger,
    //   send_message,
    //   health_and_readiness,
    // })
    // await service.init()
    global_health.ready(true)
    // await service.run()
  } catch (err) {
    logger.exception({}, err)
  }
}

main().catch((err) => {
  logger.error(`Error in main loop: ${err}`)
  logger.exception({}, err)
})
