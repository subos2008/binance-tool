#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
import { strict as assert } from "assert"

const service_name = "redis-monitor"

require("dotenv").config()
assert(process.env.REDIS_HOST)
// assert(process.env.REDIS_PASSWORD)
const connection_check_interval_seconds: number = Number(process.env.CONNECTION_TEST_INTERVAL_SECONDS) || 60
// TODO: this needs to be long enough that there would have been a trade in the timeframe
const check_positions_interval_seconds: number = Number(process.env.CHECK_POSITIONS_INTERVAL_SECONDS) || 60

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "redis-monitor")
})

import { Logger } from "../interfaces/logger"
const LoggerClass = require("../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { SendMessage, SendMessageFunc } from "../lib/telegram-v2"
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
})

import { get_redis_client, set_redis_logger } from "../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()
import { SymbolPrices } from "../classes/persistent_state/redis_symbol_prices"
const symbol_prices = new SymbolPrices({ logger, redis, exchange_name: "binance", seconds: 5 * 60 })

const { promisify } = require("util")
const incrAsync = promisify(redis.incr).bind(redis)

function ping() {
  incrAsync("redis-monitor:incr")
    .then((res: any) => {
      logger.info(`Connection Check: OK (${res})`)
    })
    .catch((err: any) => {
      logger.error(`Exception when checking redis connection with incr`)
      logger.error({ err })
      Sentry.captureException(err)
    })
}

import { RedisTrades } from "../classes/persistent_state/redis_trades"
const redis_trades = new RedisTrades({ logger, redis })

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")
  setInterval(ping, connection_check_interval_seconds * 1000)
}

// TODO: exceptions / sentry
main().catch((err) => {
  Sentry.captureException(err)
  logger.error(`Error in main loop: ${err}`)
  logger.error({ err })
  logger.error(`Error in main loop: ${err.stack}`)
})
