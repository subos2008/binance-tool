#!./node_modules/.bin/ts-node

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({
  dsn: "https://ebe019da62da46189b217c476ec1ab62@o369902.ingest.sentry.io/5326470",
})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "cli")
  scope.setTag("cli", "set-stop")
})

import { Logger } from "../interfaces/logger"
const LoggerClass = require("../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

let service_name = "cli"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

const yargs = require("yargs")

import { ExchangeIdentifier } from "../events/shared/exchange-identifier"
import { CurrentPortfolioGetter } from "../interfaces/exchange/generic/portfolio-getter"
import { Balance } from "../interfaces/portfolio"
import { BinancePortfolioGetter } from "../interfaces/exchange/binance/binance-portfolio-getter"
import { BinancePriceGetter } from "../interfaces/exchange/binance/binance-price-getter"
import { CurrentPriceGetter } from "../interfaces/exchange/generic/price-getter"
import { nextTick } from "process"

require("dotenv").config()

async function main() {
  yargs
    .strict()
    .command(
      ["list", "$0"],
      "list portfolio on an exhange",
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
      },
      list_portfolio
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
function mint_portfolio_getter({
  exchange_identifier,
}: {
  exchange_identifier: ExchangeIdentifier
}): CurrentPortfolioGetter {
  if (exchange_identifier.exchange === "binance") {
    const Binance = require("binance-api-node").default
    const ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET,
    })
    return new BinancePortfolioGetter({ ee })
  } else {
    throw new Error(`Exchange ${exchange_identifier.exchange} not implemented`)
  }
}

async function convert_to_usd({
  exchange_identifier,
  base_asset,
  quantity,
}: {
  base_asset: string
  exchange_identifier: ExchangeIdentifier
  quantity: BigNumber
}): Promise<BigNumber> {
  return (
    await get_current_price({ exchange_identifier, market_symbol: `${base_asset.toUpperCase()}USDT` })
  ).times(quantity)
}
export interface DecoratedBalance {
  asset: string
  total: BigNumber
  usd_equivalent?: BigNumber
}
function decorate_balances(balances: Balance[]) {
  return balances.map((b) => ({ asset: b.asset, total: new BigNumber(b.free).plus(b.locked) }))
}
async function get_current_portfolio({
  exchange_identifier,
}: {
  exchange_identifier: ExchangeIdentifier
}): Promise<Balance[]> {
  return await mint_portfolio_getter({ exchange_identifier }).get_balances()
}
async function get_decorated_balances({
  exchange_identifier,
}: {
  exchange_identifier: ExchangeIdentifier
}): Promise<DecoratedBalance[]> {
  let balances: Balance[] = await get_current_portfolio({ exchange_identifier })
  let decorated_balances: DecoratedBalance[] = decorate_balances(balances)
  for (const balance of decorated_balances) {
    try {
      balance.usd_equivalent = (
        await convert_to_usd({
          base_asset: balance.asset,
          quantity: balance.total,
          exchange_identifier,
        })
      ).dp(0)
    } catch (err) {
      // console.error(`Error processing info for ${balance}: ${err}`)
    }
  }
  return decorated_balances.filter((b) => b.usd_equivalent?.isGreaterThanOrEqualTo(20))
}

async function list_portfolio(argv: any) {
  let exchange_identifier = { exchange: argv.exchange, account: argv.account }
  let decorated_balances: DecoratedBalance[] = await get_decorated_balances({ exchange_identifier })
  if (decorated_balances.length === 0) {
    console.log(`No open positions`)
    return
  }
  for (const balance of decorated_balances) {
    try {
      console.log(`${balance.asset}: \$${balance.usd_equivalent?.toFixed()}`)
    } catch (err) {
      console.error(`Error processing info for ${balance}: ${err}`)
    }
  }
}
