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

let service_name = "cli"
import { SendMessage, SendMessageFunc } from "../classes/send_message/publish"
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

import { RedisClient } from "redis"
import { get_redis_client, set_redis_logger } from "../lib/redis"
set_redis_logger(logger)
const redis: RedisClient = get_redis_client()

// if(!redis.connected) throw new Error(`Redis not connected`)

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

const yargs = require("yargs")
const c = require("ansi-colors")

import { SpotPositionsQuery } from "../classes/spot/abstractions/spot-positions-query"
import { SpotPositionsPersistance } from "../classes/spot/persistence/interface/spot-positions-persistance"
// import { Position } from "../classes/position"
import { SpotPositionIdentifier_V3, SpotPositionsQuery_V3 } from "../classes/spot/abstractions/position-identifier"
import { ExchangeIdentifier_V3 } from "../events/shared/exchange-identifier"
import { BinancePriceGetter } from "../interfaces/exchanges/binance/binance-price-getter"
import { CurrentPriceGetter } from "../interfaces/exchanges/generic/price-getter"
import { RedisSpotPositionsPersistance } from "../classes/spot/persistence/redis-implementation/redis-spot-positions-persistance-v3"

require("dotenv").config()

const positions_persistance: SpotPositionsPersistance = new RedisSpotPositionsPersistance({ logger, redis })

async function main() {
  yargs
    .strict()
    .command(
      ["list", "$0"],
      "list all positions",
      {
        exchange: {
          description: "exchange",
          type: "string",
          default: "binance",
          choices: ["binance"],
        },
        account: {
          description: "account id",
          type: "string",
          default: "default",
          choices: ["default"],
        },
        exchange_type: {
          description: "exchange type",
          type: "string",
          default: "spot",
          choices: ["spot"],
        },
      },
      list_positions
    )
    .command(["fixinate"], "custom hacks - do not run!", {}, fixinate)
    .command("describe", "Describe position data from redis", {
      symbol: {
        description: "base asset, i.e. if you bought BTC-USDT this would be BTC",
        type: "string",
        demandOption: true,
      },
      exchange: {
        description: "exchange",
        type: "string",
        default: "binance",
        choices: ["binance"],
      },
      account: {
        description: "account id",
        type: "string",
        default: "default",
        choices: ["default"],
      },
      exchange_type: {
        description: "exchange type",
        type: "string",
        default: "spot",
        choices: ["spot"],
      },
      describe_position,
    })
    .command(
      "delete",
      "delete position data directly from redis. This is low level.",
      {
        symbol: {
          description: "base asset, i.e. if you bought BTC-USDT this would be BTC",
          type: "string",
          demandOption: true,
        },
        exchange: {
          description: "exchange",
          type: "string",
          default: "binance",
          choices: ["binance"],
        },
        account: {
          description: "account id",
          type: "string",
          default: "default",
          choices: ["default"],
        },
        exchange_type: {
          description: "exchange type",
          type: "string",
          default: "spot",
          choices: ["spot"],
        },
      },
      delete_position
    )
    .help()
    .alias("help", "h").argv
}
main().then(() => {})

let price_getters: { [exchange: string]: CurrentPriceGetter } = {}
function mint_price_getter({
  exchange_identifier,
}: {
  exchange_identifier: ExchangeIdentifier_V3
}): CurrentPriceGetter {
  if (exchange_identifier.exchange === "binance") {
    const Binance = require("binance-api-node").default
    const ee = Binance({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
    })
    return new BinancePriceGetter({ logger, ee })
  } else {
    throw new Error(`Exchange ${exchange_identifier.exchange} not implemented`)
  }
}
async function get_current_price({
  exchange_identifier,
  market_symbol,
}: {
  exchange_identifier: ExchangeIdentifier_V3
  market_symbol: string
}): Promise<BigNumber> {
  if (!(exchange_identifier.exchange in price_getters)) {
    price_getters[exchange_identifier.exchange] = mint_price_getter({ exchange_identifier })
  }
  return price_getters[exchange_identifier.exchange].get_current_price({ market_symbol })
}

async function list_positions({
  exchange,
  exchange_type,
  account,
}: {
  exchange: string
  exchange_type: string
  account: string
}) {
  if (exchange_type !== "spot") throw new Error(`Not implemented`)
  const spot_positions_query = new SpotPositionsQuery({
    logger,
    positions_persistance,
    send_message,
    exchange_identifier: { exchange, type: exchange_type, account, version: "v3" },
  })
  console.warn(`This implementation uses an initial_entry_price and not an average entry price`)
  let open_positions: SpotPositionIdentifier_V3[] = await spot_positions_query.open_positions()
  if (open_positions.length === 0) {
    console.log(`No open positions`)
    return
  }
  for (const position_identifier of open_positions) {
    try {
      let p = await spot_positions_query.position(position_identifier)
      let exchange_identifier = position_identifier.exchange_identifier
      let quote_asset: string = await p.initial_entry_quote_asset()
      let percentage_change
      let price_change_string = "(null)"
      try {
        let current_price: BigNumber = await get_current_price({
          exchange_identifier,
          market_symbol: `${position_identifier.base_asset}${quote_asset}`,
        })
        let entry_price: BigNumber = await p.initial_entry_price()
        percentage_change = current_price.dividedBy(entry_price).times(100).minus(100).dp(1)
        if (percentage_change) {
          price_change_string = `${percentage_change.isGreaterThan(0) ? "+" : ""}${percentage_change}%`
          if (percentage_change.isLessThan(0)) price_change_string = c.red(price_change_string)
        }
      } catch (err) {
        console.error(err)
      }
      price_change_string = `${price_change_string} vs ${quote_asset}`
      let pi = position_identifier
      let ei = position_identifier.exchange_identifier
      console.log(
        `${pi.base_asset}: ${price_change_string} (${ei.type}:${ei.exchange}:${ei.account}, edge ${pi.edge})`
      )
    } catch (err) {
      console.error(`Error processing info for ${position_identifier.base_asset}: ${err}`)
    }
  }
  redis.quit()
}

async function fixinate() {
  // console.warn(`This implementation uses an initial_entry_price and not an average entry price`)
  // let open_positions = await positions.open_positions()
  // if (open_positions.length === 0) {
  //   console.log(`No open positions`)
  //   return
  // }
  // for (const position_identifier of open_positions) {
  //   try {
  //     let p = new Position({ logger, send_message, positions, position_identifier })
  //     await p.initial_entry_quote_asset()
  //   } catch (err) {
  //     console.error(`Error processing info for ${position_identifier.base_asset}: ${err}`)
  //     if (err.toString().includes("initial_entry_quote_asset missing")) {
  //       await positions._patch_initial_entry_quote_asset(position_identifier, {
  //         initial_entry_quote_asset: "USDT",
  //       })
  //     }
  //     if (err.toString().includes("initial_entry_timestamp missing")) {
  //       await positions._patch_initial_entry_timestamp(position_identifier, {
  //         initial_entry_timestamp: Date.now(),
  //       })
  //     }
  //   }
  // }
  redis.quit()
}

async function delete_position(argv: any) {
  let position_identifier = argv // sorry Mum
  await positions_persistance.delete_position(position_identifier)
  redis.quit()
}

async function describe_position({
  exchange,
  exchange_type,
  account,
  edge,
  symbol,
}: {
  exchange: string
  account: string
  exchange_type: string
  edge: string
  symbol: string
}) {
  if (exchange_type !== "spot") throw new Error(`Not implemented`)

  const exchange_identifier: ExchangeIdentifier_V3 = { exchange, type: exchange_type, account, version: "v3" }
  let query: SpotPositionsQuery_V3 = { exchange_identifier, base_asset: symbol }
  const spot_positions_query = new SpotPositionsQuery({
    logger,
    positions_persistance,
    send_message,
    exchange_identifier: { exchange, type: exchange_type, account, version: "v3" },
  })
  let position_identifiers: SpotPositionIdentifier_V3[] = await spot_positions_query.query_open_positions(query)
  console.log(`position_identifiers:`)
  console.log(position_identifiers)
  // change to PositionQuery
  for (const position_identifier of position_identifiers) {
    let p = await spot_positions_query.position(position_identifier)
    console.log(`${p.base_asset}:`)
    console.log(await p.describe_position())
  }
  redis.quit()
}
