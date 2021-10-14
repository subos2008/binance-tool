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
const send_message = require("../lib/telegram.js")(`${service_name}: `)

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
const c = require("ansi-colors")

import { RedisPositionsState } from "../classes/persistent_state/redis_positions_state"
const redis_positions = new RedisPositionsState({ logger, redis })

import { Position } from "../classes/position"
import { create_position_identifier_from_tuple, PositionIdentifier } from "../events/shared/position-identifier"
import { ExchangeIdentifier } from "../events/shared/exchange-identifier"
import { BinancePriceGetter } from "../interfaces/exchange/binance/binance-price-getter"
import { CurrentPriceGetter } from "../interfaces/exchange/generic/price-getter"

require("dotenv").config()

async function main() {
  yargs
    .strict()
    .command(["list", "$0"], "list all positions", {}, list_positions)
    .command(["fixinate"], "custom hacks - do not run!", {}, fixinate)
    .command(
      "describe",
      "Describe position data from redis",
      {
        symbol: {
          description: "base asset, i.e. if you bought BTC-USDT this would be BTC",
          type: "string",
          demandOption: true,
          choices: (await redis_positions.open_positions()).map((p: PositionIdentifier) => p.baseAsset),
        },
        exchange: {
          description: "exchange",
          type: "string",
          default: "binance",
          choices: (await redis_positions.open_positions()).map(
            (p: PositionIdentifier) => p.exchange_identifier.exchange
          ),
        },
        account: {
          description: "account id",
          type: "string",
          default: "default",
          choices: (await redis_positions.open_positions()).map(
            (p: PositionIdentifier) => p.exchange_identifier.account
          ),
        },
      },
      describe_position
    )
    .command(
      "delete",
      "delete position data from redis",
      {
        symbol: {
          description: "base asset, i.e. if you bought BTC-USDT this would be BTC",
          type: "string",
          demandOption: true,
          choices: (await redis_positions.open_positions()).map((p: PositionIdentifier) => p.baseAsset),
        },
        exchange: {
          description: "exchange",
          type: "string",
          default: "binance",
          choices: (await redis_positions.open_positions()).map(
            (p: PositionIdentifier) => p.exchange_identifier.exchange
          ),
        },
        account: {
          description: "account id",
          type: "string",
          default: "default",
          choices: (await redis_positions.open_positions()).map(
            (p: PositionIdentifier) => p.exchange_identifier.account
          ),
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
  exchange_identifier: ExchangeIdentifier
}): CurrentPriceGetter {
  if (exchange_identifier.exchange === "binance") {
    const Binance = require("binance-api-node").default
    const ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET,
    })
    return new BinancePriceGetter({ ee })
  } else {
    throw new Error(`Exchange ${exchange_identifier.exchange} not implemented`)
  }
}
async function get_current_price({
  exchange_identifier,
  market_symbol,
}: {
  exchange_identifier: ExchangeIdentifier
  market_symbol: string
}): Promise<BigNumber> {
  if (!(exchange_identifier.exchange in price_getters)) {
    price_getters[exchange_identifier.exchange] = mint_price_getter({ exchange_identifier })
  }
  return price_getters[exchange_identifier.exchange].get_current_price({ market_symbol })
}

async function list_positions() {
  console.warn(`This implementation uses an initial_entry_price and not an average entry price`)
  let open_positions = await redis_positions.open_positions()
  if (open_positions.length === 0) {
    console.log(`No open positions`)
    return
  }
  for (const position_identifier of open_positions) {
    try {
      let p = new Position({ logger, send_message, redis_positions, position_identifier })
      let exchange_identifier = position_identifier.exchange_identifier
      let quote_asset: string = await p.initial_entry_quote_asset()
      let percentage_change
      let price_change_string = "(null)"
      try {
        let current_price: BigNumber = await get_current_price({
          exchange_identifier,
          market_symbol: `${position_identifier.baseAsset}${quote_asset}`,
        })
        let entry_price: BigNumber = await p.initial_entry_price()
        percentage_change = current_price.dividedBy(entry_price).times(100).minus(100).dp(1)
        if (percentage_change) {
          price_change_string = `${percentage_change.isGreaterThan(0) ? "+" : ""}${percentage_change}%`
          if (percentage_change.isLessThan(0)) price_change_string = c.red(price_change_string)
        }
      } catch (e) {}
      price_change_string = `${price_change_string} vs ${quote_asset}`
      console.log(`${position_identifier.baseAsset}: ${price_change_string}`)
    } catch (err) {
      console.error(`Error processing info for ${position_identifier.baseAsset}: ${err}`)
    }
  }
  redis.quit()
}

async function fixinate() {
  // console.warn(`This implementation uses an initial_entry_price and not an average entry price`)
  // let open_positions = await redis_positions.open_positions()
  // if (open_positions.length === 0) {
  //   console.log(`No open positions`)
  //   return
  // }
  // for (const position_identifier of open_positions) {
  //   try {
  //     let p = new Position({ logger, send_message, redis_positions, position_identifier })
  //     await p.initial_entry_quote_asset()
  //   } catch (err) {
  //     console.error(`Error processing info for ${position_identifier.baseAsset}: ${err}`)
  //     if (err.toString().includes("initial_entry_quote_asset missing")) {
  //       await redis_positions._patch_initial_entry_quote_asset(position_identifier, {
  //         initial_entry_quote_asset: "USDT",
  //       })
  //     }
  //     if (err.toString().includes("initial_entry_timestamp missing")) {
  //       await redis_positions._patch_initial_entry_timestamp(position_identifier, {
  //         initial_entry_timestamp: Date.now(),
  //       })
  //     }
  //   }
  // }
  redis.quit()
}

async function delete_position(argv: any) {
  let position_identifier = create_position_identifier_from_tuple({ ...argv, baseAsset: argv["symbol"] })
  await redis_positions.close_position(position_identifier)
  redis.quit()
}

async function describe_position(argv: any) {
  let position_identifier = create_position_identifier_from_tuple({ ...argv, baseAsset: argv["symbol"] })
  console.log(position_identifier)
  let p = new Position({ logger, send_message, redis_positions, position_identifier })
  console.log(`${p.baseAsset}:`)
  console.log(await p.describe_position())
  redis.quit()
}
