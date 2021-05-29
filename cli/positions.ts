#!./node_modules/.bin/ts-node

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({
  dsn: "https://ebe019da62da46189b217c476ec1ab62@o369902.ingest.sentry.io/5326470",
})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "cli")
  scope.setTag("cli", "positions")
})

import { Logger } from "../interfaces/logger"
const LoggerClass = require("../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { get_redis_client, set_redis_logger } from "../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

const yargs = require("yargs")

import { RedisPositionsState } from "../classes/persistent_state/redis_positions_state"
import { LegacyRedisPositionsState } from "../classes/persistent_state/legacy-redis_positions_state"
const redis_positions = new RedisPositionsState({ logger, redis })
const legacy_redis_positions = new RedisPositionsState({ logger, redis })

import { Position } from "../classes/position"
import { PositionIdentifier, create_position_identifier_from_tuple } from "../events/shared/position-identifier"
import { ExchangeIdentifier } from "../events/shared/exchange-identifier"
import { ExchangeEmulator } from "../lib/exchange_emulator"

const Binance = require("binance-api-node").default
require("dotenv").config()

const c = require("ansi-colors")

async function main() {
  yargs
    .strict()
    .command(["list"], "list all positions", {}, list_positions)
    .command(["list-legacy", "$0"], "list all positions", {}, legacy_list_positions)
    .command(
      "describe",
      "Describe position data from redis",
      {
        symbol: {
          description: "symbol",
          type: "string",
          demandOption: true,
          choices: (await redis_positions.open_position_ids()).map((data: { symbol: string }) => data.symbol),
        },
        exchange: {
          description: "exchange",
          type: "string",
          default: "binance",
          choices: (await redis_positions.open_position_ids()).map((data: { exchange: string }) => data.exchange),
        },
        account: {
          description: "account id",
          type: "string",
          default: "default",
          choices: (await redis_positions.open_position_ids()).map((data: { account: string }) => data.account),
        },
      },
      describe_position
    )
    .command(
      "delete",
      "delete position data from redis",
      {
        symbol: {
          description: "symbol",
          type: "string",
          demandOption: true,
          choices: (await redis_positions.open_position_ids()).map((data: { symbol: string }) => data.symbol),
        },
        exchange: {
          description: "exchange",
          type: "string",
          default: "binance",
          choices: (await redis_positions.open_position_ids()).map((data: { exchange: string }) => data.exchange),
        },
        account: {
          description: "account id",
          type: "string",
          default: "default",
          choices: (await redis_positions.open_position_ids()).map((data: { account: string }) => data.account),
        },
      },
      delete_position
    )
    .command(
      "delete-legacy",
      "delete position data from redis",
      {
        symbol: {
          description: "symbol",
          type: "string",
          demandOption: true,
          choices: (await legacy_redis_positions.open_position_ids()).map((data: { symbol: string }) => data.symbol),
        },
        exchange: {
          description: "exchange",
          type: "string",
          default: "binance",
          choices: (await legacy_redis_positions.open_position_ids()).map((data: { exchange: string }) => data.exchange),
        },
        account: {
          description: "account id",
          type: "string",
          default: "default",
          choices: (await legacy_redis_positions.open_position_ids()).map((data: { account: string }) => data.account),
        },
      },
      legacy_delete_position
    )
    .help()
    .alias("help", "h").argv
}
main().then(() => {})

async function get_prices_from_exchange() {
  const ee = Binance({
    apiKey: process.env.APIKEY,
    apiSecret: process.env.APISECRET,
  })
  return await ee.prices()
}

async function legacy_list_positions(argv: any) {
  console.warn(`This implementation uses an initial_entry_price and not an average entry price`)
  let open_positions = await legacy_redis_positions.open_positions()
  for (const position_identifier of open_positions) {
    console.log(position_identifier)
  }
  redis.quit()
}

async function list_positions(argv: any) {
  console.warn(`This implementation uses an initial_entry_price and not an average entry price`)
  let prices = await get_prices_from_exchange()
  let open_positions = await redis_positions.open_positions()
  for (const position_identifier of open_positions) {
    let p = new Position({ logger, redis_positions, position_identifier })
    await p.load_and_init({ prices })
    // let percentage = p.percentage_price_change_since_initial_entry?.dp(1)
    // let percentage_string: string = p.percentage_price_change_since_initial_entry?.isGreaterThanOrEqualTo(0)
    //   ? percentage?.toFixed()
    //   : c.red(percentage?.toFixed())
    console.log(`${p.baseAsset}: unimplemented`)
  }
  redis.quit()
}

async function delete_position(argv: any) {
  await redis_positions.close_position(argv)
  redis.quit()
}

async function legacy_delete_position(argv: any) {
  await legacy_redis_positions.close_position(argv)
  redis.quit()
}

async function describe_position(argv: any) {
  let position_identifier = create_position_identifier_from_tuple(argv)
  console.log(position_identifier)
  let prices = await get_prices_from_exchange()
  let p = new Position({ logger, redis_positions, position_identifier })
  await p.load_and_init({ prices })
  console.log(`${p.baseAsset}:`)
  console.log(p.asObject())
  redis.quit()
}
