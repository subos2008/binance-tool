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
async function get_current_portfolio({
  exchange_identifier,
}: {
  exchange_identifier: ExchangeIdentifier
}): Promise<Balance[]> {
  return mint_portfolio_getter({ exchange_identifier }).get_balances()
}
async function list_portfolio(argv: any) {
  let exchange_identifier = { exchange: argv.exchange, account: argv.account }
  let balances: Balance[] = await get_current_portfolio({ exchange_identifier })
  if (balances.length === 0) {
    console.log(`No open positions`)
    return
  }
  for (const balance of balances) {
    try {
      console.log(balance)
    } catch (err) {
      console.error(`Error processing info for ${balance}: ${err}`)
    }
  }
}
