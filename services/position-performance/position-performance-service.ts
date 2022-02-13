#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"

require("dotenv").config()

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

const service_name = "position-performance"

const update_interval_seconds: number = Number(process.env.UPDATE_INTERVAL_SECONDS) || 2 * 60 * 60

import { get_redis_client, set_redis_logger } from "../../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()
import { RedisClient } from "redis"

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Binance } from "binance-api-node"

import * as Sentry from "@sentry/node"
import { SpotPosition } from "../../classes/spot/abstractions/spot-position"
import { Prices } from "../../interfaces/portfolio"
import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
import { SpotPositionsPersistance } from "../../classes/spot/persistence/interface/spot-positions-persistance"
import { SpotRedisPositionsState } from "../../classes/spot/persistence/redis-implementation/spot-redis-positions-state-v3"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import { RedisInterimSpotPositionsMetaDataPersistantStorage } from "../spot-trade-abstraction/interim-meta-data-storage"
import { BinanceSpotExecutionEngine } from "../../classes/spot/exchanges/binance/binance-spot-execution-engine"
import { RedisOrderContextPersistance } from "../../classes/spot/persistence/redis-implementation/redis-order-context-persistence"

export class PositionPerformance {
  send_message: (msg: string) => void
  logger: Logger
  spot_positions_persistance: SpotPositionsPersistance
  spot_positions_query: SpotPositionsQuery
  ee: BinanceSpotExecutionEngine
  prices: Prices | undefined

  constructor({
    send_message,
    logger,
    spot_positions_persistance,
    spot_positions_query,
    ee,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    spot_positions_persistance: SpotPositionsPersistance
    spot_positions_query: SpotPositionsQuery
    ee: BinanceSpotExecutionEngine
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
    logger.warn(`This implementation uses an initial_entry_price and not an average entry price`)
    let positions: SpotPosition[] = []
    let position_strings: string[] = []
    let open_positions = await this.spot_positions_persistance.list_open_positions()

    async function position_to_string(current_price: BigNumber, p: SpotPosition) {
      let initial_entry_price = await p.initial_entry_price()
      let percentage = (await p.percentage_price_change_since_initial_entry(current_price)).dp(1)
      let percentage_string: string = percentage?.toFixed() || "?"
      return `${p.baseAsset}: ${percentage_string}% (entry: ${initial_entry_price.toFixed()})`
    }

    for (const position_identifier of open_positions) {
      let p = await this.spot_positions_query.position(position_identifier)
      positions.push(p)
      position_strings.push(await position_to_string(await this.current_price(p), p))
    }

    if (position_strings.length > 0) {
      let msg: string = position_strings.join("\n")
      this.send_message(`\n${msg}`)
    }
  }

  async update() {
    let ee: Binance = this.ee.get_raw_binance_ee()
    this.prices = await ee.prices()
    await this.list_positions()
  }
}

async function main() {
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
  const spot_positions_persistance: SpotPositionsPersistance = new SpotRedisPositionsState({ logger, redis })
  const interim_spot_positions_metadata_persistant_storage =
    new RedisInterimSpotPositionsMetaDataPersistantStorage({
      logger,
      redis,
    })
  const order_context_persistence = new RedisOrderContextPersistance({ logger, redis })
  const binance = new BinanceSpotExecutionEngine({ logger, order_context_persistence })

  const spot_positions_query = new SpotPositionsQuery({
    logger,
    exchange_identifier: binance.get_exchange_identifier(),
    positions_persistance: spot_positions_persistance,
    send_message,
    interim_spot_positions_metadata_persistant_storage,
  })

  let position_performance = new PositionPerformance({
    logger,
    send_message,
    ee: binance,
    spot_positions_persistance,
    spot_positions_query,
  })

  // Update on intervals
  let bound_update = position_performance.update.bind(position_performance)

  bound_update()
  setInterval(bound_update, update_interval_seconds * 1000)
}

main().catch((error) => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`)
  logger.error(error)
  logger.error(`Error in main loop: ${error.stack}`)
  soft_exit(1)
})

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null) {
  redis.quit()

  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`)
  if (exit_code) process.exitCode = exit_code
  // if (publisher) publisher.shutdown_streams()
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
