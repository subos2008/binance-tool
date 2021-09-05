#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"

require("dotenv").config()

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

const service_name = "position-performance"
const send_message = require("../../lib/telegram.js")(`${service_name}: `)

const update_interval_seconds: number = Number(process.env.UPDATE_INTERVAL_SECONDS) || 6 * 60 * 60

import { get_redis_client, set_redis_logger } from "../../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()
import { RedisClient } from "redis"
import { RedisPositionsState } from "../../classes/persistent_state/redis_positions_state"
const redis_positions = new RedisPositionsState({ logger, redis })

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Binance } from "binance-api-node"
import BinanceFactory from "binance-api-node"

import * as Sentry from "@sentry/node"
import { Position } from "../../classes/position"
import { Prices } from "../../interfaces/portfolio"

export class PositionPerformance {
  send_message: Function
  logger: Logger
  positions_state: RedisPositionsState
  ee: Binance
  prices: Prices

  constructor({
    send_message,
    logger,
    redis,
    ee,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    redis: RedisClient
    ee: Binance
  }) {
    assert(logger)
    this.ee = ee
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.positions_state = new RedisPositionsState({ logger, redis })
  }

  current_price(p: Position): BigNumber {
    let symbol = p.baseAsset + p.initial_entry_quote_asset()
    return new BigNumber(this.prices[symbol])
  }

  async list_positions() {
    logger.warn(`This implementation uses an initial_entry_price and not an average entry price`)
    let positions: Position[] = []
    let position_strings: string[] = []
    let open_positions = await redis_positions.open_positions()

    async function position_to_string(p: Position) {
      let current_price = this.current_price(p)
      let percentage = (await p.percentage_price_change_since_initial_entry(current_price)).dp(1)
      let percentage_string: string = percentage?.toFixed() || "?"
      return `${p.baseAsset}: ${percentage_string}`
    }

    for (const position_identifier of open_positions) {
      let p = new Position({ logger, redis_positions, position_identifier })
      positions.push(p)
      position_strings.push(await position_to_string(p))
    }

    if (position_strings.length > 0) {
      let msg: string = position_strings.join("\n")
      this.send_message(`\n${msg}`)
    }
  }

  async update() {
    this.prices = await this.ee.prices()
    await this.list_positions()
  }
}

let ee: Binance
// let portfolio_tracker: PortfolioTracker
// const portfolio_utils: PortfolioUtils = new PortfolioUtils({ logger, sentry: Sentry })

async function main() {
  logger.info("Live monitoring mode")
  if (!process.env.APIKEY) throw new Error(`Missing APIKEY in ENV`)
  if (!process.env.APISECRET) throw new Error(`Missing APISECRET in ENV`)
  ee = BinanceFactory({
    apiKey: process.env.APIKEY,
    apiSecret: process.env.APISECRET,
  })

  const execSync = require("child_process").execSync
  execSync("date -u")

  let position_performance = new PositionPerformance({ logger, send_message, ee, redis })

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
