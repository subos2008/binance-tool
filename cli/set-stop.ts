#!./node_modules/.bin/ts-node

require("dotenv").config()

import Sentry from "../lib/sentry"
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
import { CurrentPortfolioGetter } from "../interfaces/exchanges/generic/portfolio-getter"
import { Balance } from "../interfaces/portfolio"
import { BinancePortfolioGetter } from "../interfaces/exchanges/binance/binance-portfolio-getter"
import { BinancePriceGetter } from "../interfaces/exchanges/binance/binance-price-getter"
import { CurrentPriceGetter } from "../interfaces/exchanges/generic/price-getter"
import { nextTick } from "process"
import { Binance, QueryOrderResult } from "binance-api-node"
import { strict as assert } from "assert"
import { GenericOrder, OrdersGetter } from "../interfaces/exchanges/generic/orders-getter"
import { BinanceOrdersGetter } from "../interfaces/exchanges/binance/binance-orders-getter"

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
        quote: {
          description: "quote asset to determine market for orders",
          type: "string",
          default: "USDT",
          choices: ["USDT"],
        },
        orders: {
          description: "show all orders",
          type: "boolean",
          default: false,
        },
      },
      list_portfolio
    )
    .command(
      ["describe"],
      "describe orders for a position on an exchange",
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
        quote: {
          description: "quote asset to determine market for orders",
          type: "string",
          default: "USDT",
          choices: ["USDT"],
        },
        base: {
          description: "base asset to determine market for orders",
          type: "string",
        },
      },
      describe_position
    )
    .help()
    .alias("help", "h").argv
}
main().then(() => {})

var _ee: Binance | null = null
function get_ee(): Binance {
  if (_ee) return _ee
  const Binance = require("binance-api-node").default
  const ee = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
  })
  _ee = ee
  return ee
}

let price_getters: { [exchange: string]: CurrentPriceGetter } = {}
function mint_price_getter({
  exchange_identifier,
}: {
  exchange_identifier: ExchangeIdentifier
}): CurrentPriceGetter {
  if (exchange_identifier.exchange === "binance") {
    return new BinancePriceGetter({ logger, ee: get_ee() })
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
    return new BinancePortfolioGetter({ ee: get_ee() })
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

async function get_all_open_orders_for_symbol({
  exchange_identifier,
  base_symbol,
  quote_symbol,
}: {
  exchange_identifier: ExchangeIdentifier
  base_symbol: string
  quote_symbol: string
}): Promise<GenericOrder[]> {
  assert(exchange_identifier.exchange === "binance")
  let ee: Binance = get_ee()
  let orders_getter: OrdersGetter = new BinanceOrdersGetter({ ee })
  return await orders_getter.get_open_orders_on_specific_market({ market_symbol: `${base_symbol}${quote_symbol}` })
}

async function list_portfolio(argv: any) {
  let { quote: quote_symbol } = argv
  let exchange_identifier = { exchange: argv.exchange, account: argv.account }
  let decorated_balances: DecoratedBalance[] = await get_decorated_balances({ exchange_identifier })
  if (decorated_balances.length === 0) {
    console.log(`No open positions`)
    return
  }
  for (const balance of decorated_balances) {
    try {
      console.log(`${balance.asset}: \$${balance.usd_equivalent?.toFixed()}`)
      if (argv.orders) {
        let orders = await get_all_open_orders_for_symbol({
          exchange_identifier,
          base_symbol: balance.asset,
          quote_symbol,
        })
        console.log(orders)
      }
    } catch (err) {
      console.error(`Error processing info for ${balance.asset}: ${err}`)
      process.exit(1)
    }
  }
}

function generic_order_to_string(o: GenericOrder) {
  return `${o.exchangeOrderListId ? "OCO " : ""}${o.orderType} ${o.side}`
}

function orders_related_to_stop_price(orders: GenericOrder[], stop_price: BigNumber) {
  let stop_orders: GenericOrder[] = orders.filter((o) => stop_price.isEqualTo(o.stopPrice))
  let oco_list_order_ids = stop_orders.filter((o) => o.exchangeOrderListId).map((o) => o.exchangeOrderListId)
  console.log(`oco_list_order_ids:`)
  console.log(oco_list_order_ids)
  let non_oco_stop_orders: GenericOrder[] = stop_orders.filter((o) => !o.exchangeOrderListId)
  let oco_stop_orders_object: { [stop_price: string]: GenericOrder[] } = {}
  for (const oco_list_order_id of oco_list_order_ids) {
    if (oco_list_order_id === undefined) continue
    oco_stop_orders_object[oco_list_order_id] = orders.filter((o) => oco_list_order_id === o.exchangeOrderListId)
  }
  console.log(`non_oco_stop_orders:`)
  console.log(non_oco_stop_orders)
  console.log(`oco_stop_orders_object:`)
  console.log(oco_stop_orders_object)
  return { non_oco_stop_orders, oco_stop_orders_object }
}

function chew(orders: GenericOrder[]): any {
  let stops: string[] = [...new Set(orders.map((o) => o.stopPrice))]
  let non_zero_stops = stops.filter((s) => !new BigNumber(s).isZero())

  if (non_zero_stops.length === 1) {
    // Make a list of stop orders and a set of OCO orders related to stop orders
    let foo_orders = {
      [non_zero_stops[0]]: orders_related_to_stop_price(orders, new BigNumber(non_zero_stops[0])),
    }
    return { non_zero_stops, foo_orders }
  }

  return { non_zero_stops }
}

function recreate_stop_order_with_different_stop_price(order: GenericOrder) {
  // TODO: check order type
  // TODO: cancel order
  // TODO: convert and create order with new stop price
}

async function describe_position(argv: any) {
  let { quote: quote_symbol, base: base_asset } = argv
  let exchange_identifier = { exchange: argv.exchange, account: argv.account }
  let decorated_balances: DecoratedBalance[] = await get_decorated_balances({ exchange_identifier })
  const balance = decorated_balances.find((b) => b.asset === base_asset)
  if (!balance) {
    console.log(`No open positions in ${base_asset}`)
    return
  }
  try {
    console.log(`${balance.asset}: \$${balance.usd_equivalent?.toFixed()}`)
    let orders = await get_all_open_orders_for_symbol({
      exchange_identifier,
      base_symbol: balance.asset,
      quote_symbol,
    })
    console.log(orders.map(generic_order_to_string))
    console.log(chew(orders))
  } catch (err) {
    console.error(`Error processing info for ${balance.asset}: ${err}`)
    process.exit(1)
  }
}
