#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

import { strict as assert } from "assert"

require("dotenv").config()

const service_name = "position-performance"

const update_interval_seconds: number = Number(process.env.UPDATE_INTERVAL_SECONDS) || 2 * 60 * 60

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import Sentry from "../../lib/sentry"
import { SpotPosition } from "../../classes/spot/abstractions/spot-position"
import { Prices } from "../../interfaces/portfolio"
import { SendMessage } from "../../classes/send_message/publish"
import { SpotPositionsPersistence } from "../../classes/spot/persistence/interface/spot-positions-persistance"
import { RedisSpotPositionsPersistence } from "../../classes/spot/persistence/redis-implementation/redis-spot-positions-persistance-v3"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import { TradeAbstractionServiceClient } from "../binance/spot/trade-abstraction-v2/client/tas-client"
import { CurrentAllPricesGetter } from "../../interfaces/exchanges/generic/price-getter"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { SendMessageFunc } from "../../interfaces/send-message"
import express from "express"
import { get_redis_client } from "../../lib/redis-v4"
import { ServiceLogger } from "../../interfaces/logger"
import { BunyanServiceLogger } from "../../lib/service-logger"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_class: "event", object_type: "ServiceStarting", msg: "Service starting" })

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
const service_is_healthy: HealthAndReadinessSubsystem = health_and_readiness.addSubsystem({
  name: "global",
  healthy: true,
  initialised: true,
})

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
  service_is_healthy.healthy(false)
})

export class PositionPerformance {
  send_message: SendMessageFunc
  logger: ServiceLogger
  spot_positions_persistance: SpotPositionsPersistence
  spot_positions_query: SpotPositionsQuery
  ee: CurrentAllPricesGetter
  prices: Prices | undefined

  constructor({
    send_message,
    logger,
    spot_positions_persistance,
    spot_positions_query,
    ee,
    health_and_readiness,
  }: {
    send_message: SendMessageFunc
    logger: ServiceLogger
    spot_positions_persistance: SpotPositionsPersistence
    spot_positions_query: SpotPositionsQuery
    ee: CurrentAllPricesGetter
    health_and_readiness: HealthAndReadiness
  }) {
    assert(logger)
    this.ee = ee
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.spot_positions_persistance = spot_positions_persistance
    this.spot_positions_query = spot_positions_query
  }

  async current_price(p: SpotPosition): Promise<BigNumber> {
    let base: string = p.baseAsset
    let quote: string = await p.initial_entry_quote_asset()
    let symbol = `${base}${quote}`.toUpperCase()
    if (!this.prices) throw new Error("prices not initialised")
    return new BigNumber(this.prices[symbol])
  }

  async list_positions() {
    // TODO: go via the TAS - we get prices from the TAS
    this.logger.todo(
      { level: "warn" },
      `This implementation uses an initial_entry_price and not an average entry price`
    )

    let positions: SpotPosition[] = []
    let position_strings: string[] = []
    let open_positions = await this.spot_positions_persistance.list_open_positions()

    type InterimData = {
      edge: string
      base_asset: string
      initial_entry_price: BigNumber
      percentage_price_change_since_initial_entry: BigNumber
    }

    async function data_to_string(p: InterimData) {
      let percentage_string: string = p.percentage_price_change_since_initial_entry?.dp(1).toFixed() || "?"
      return `${p.base_asset}: ${percentage_string}% (entry: ${p.initial_entry_price.toFixed()}, ${p.edge})`
    }

    /** convert pi's to positions */
    for (const position_identifier of open_positions) {
      let p: SpotPosition = await this.spot_positions_query.position(position_identifier)
      positions.push(p)
    }

    let data: InterimData[] = []
    for (const p of positions) {
      let current_price = await this.current_price(p)
      let initial_entry_price = await p.initial_entry_price()
      let percentage_price_change_since_initial_entry = await p.percentage_price_change_since_initial_entry(
        current_price
      )
      let edge = await p.edge()
      data.push({
        edge,
        base_asset: p.base_asset,
        initial_entry_price,
        percentage_price_change_since_initial_entry,
      })
    }

    /* sort, if begger return 1, smaller -1 */
    data = data.sort((a, b) =>
      a.percentage_price_change_since_initial_entry.isGreaterThan(b.percentage_price_change_since_initial_entry)
        ? 1
        : -1
    )

    for (const p of data) {
      position_strings.push(await data_to_string(p))
    }

    if (position_strings.length > 0) {
      let msg: string = position_strings.join("\n")
      this.send_message(`\n${position_strings.length} positions:\n${msg}`)
    }
  }

  async update() {
    this.prices = await this.ee.prices()
    await this.list_positions()
  }
}

const TAS_URL = process.env.SPOT_TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("SPOT_TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}

async function main() {
  const redis = await get_redis_client(logger, health_and_readiness)
  const spot_positions_persistance: SpotPositionsPersistence = new RedisSpotPositionsPersistence({ logger, redis })
  const ee = new TradeAbstractionServiceClient({ logger, TAS_URL })

  const spot_positions_query = new SpotPositionsQuery({
    logger,
    exchange_identifier: await ee.get_exchange_identifier(),
    positions_persistance: spot_positions_persistance,
    send_message,
  })

  let position_performance = new PositionPerformance({
    logger,
    send_message,
    ee,
    spot_positions_persistance,
    spot_positions_query,
    health_and_readiness,
  })

  // Update on intervals
  let bound_update = position_performance.update.bind(position_performance)

  bound_update()
  setInterval(bound_update, update_interval_seconds * 1000)
}

main().catch((err) => {
  Sentry.captureException(err)
  logger.error(`Error in main loop: ${err}`)
  logger.error({ err })
  logger.error(`Error in main loop: ${err.stack}`)
  soft_exit(1, `Error in main loop: ${err}`)
})

// Note this method returns!
function soft_exit(exit_code: number | null, reason: string) {
  service_is_healthy.healthy(false) // it seems service isn't exiting on soft exit, but add this to make sure
  logger.error(`soft_exit called, exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) process.exitCode = exit_code
}

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
