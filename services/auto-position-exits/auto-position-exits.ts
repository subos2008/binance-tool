#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"
require("dotenv").config()
const connect_options = require("../../lib/amqp/connect_options").default
const service_name = "auto-position-exits"
const routing_key = "binance"

var amqp = require("amqplib/callback_api")

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

const send_message = require("../../lib/telegram.js")(`${service_name}: `)

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

send_message("starting")

process.on("unhandledRejection", (error) => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import Binance from "binance-api-node"
import { ExchangeInfo } from "binance-api-node"

import { PositionsListener } from "../../classes/amqp/positions-listener"
import { NewPositionEvent } from "../../events/position-events"
import { ExchangeEmulator } from "../../lib/exchange_emulator"
import { timeStamp } from "console"
import { PositionIdentifier } from "../../events/shared/position-identifier"
import { ExchangeIdentifier } from "../../events/shared/exchange-identifier"
import { AlgoUtils } from "../../service_lib/algo_utils"

type GenericExchangeInterface = {
  exchangeInfo: () => Promise<ExchangeInfo>
}

export class AutoPositionExits {
  ee: GenericExchangeInterface
  logger: Logger
  send_message: (msg: string) => void
  positions_listener: PositionsListener
  algo_utils: AlgoUtils

  constructor({
    ee,
    logger,
    send_message,
  }: {
    ee: GenericExchangeInterface
    logger: Logger
    send_message: (msg: string) => void
  }) {
    this.ee = ee
    this.logger = logger
    this.send_message = send_message
    this.algo_utils = new AlgoUtils({ logger: this.logger, ee: this.ee })
  }

  async main() {
    if (this.positions_listener) return
    this.positions_listener = new PositionsListener({
      logger: this.logger,
      send_message: this.send_message,
      exchange: routing_key,
      callbacks: this,
    })
    this.algo_utils.set_exchange_info(await this.ee.exchangeInfo())
    return this.positions_listener.connect()
  }

  async _add_sell_order_at_percentage_above_price({
    exchange_identifier,
    symbol,
    position_initial_entry_price,
    position_size,
    percentage_to_sell,
    percentage_price_increase_to_sell_at,
  }: {
    exchange_identifier: ExchangeIdentifier
    symbol: string
    position_initial_entry_price: BigNumber
    position_size: BigNumber
    percentage_to_sell: BigNumber
    percentage_price_increase_to_sell_at: BigNumber
  }) {
    let sell_price = position_initial_entry_price.times(
      percentage_price_increase_to_sell_at.dividedBy(100).plus(1)
    )
    let sell_quantity = position_size.times(percentage_to_sell.dividedBy(100).plus(1))
    this.logger.info(`Creating limit sell: ${symbol}, ${sell_quantity.toFixed()} at price ${sell_price.toFixed()}`)
    await this.algo_utils.create_limit_sell_order({ pair: symbol, price: sell_price, base_amount: sell_quantity })
  }

  async new_position_event_callback(event: NewPositionEvent) {
    assert(event.event_type === "NewPositionEvent")
    this.logger.info(event)

    if (!event.position_initial_entry_price) {
      this.send_message(
        `${event.symbol} NewPositionEvent missing position_initial_entry_price, skipping auto exit orders`
      )
      return
    }

    async function sell_x_at_x(context: AutoPositionExits, amount_percentage: string, price_percentage: string) {
      try {
        if (!event.position_initial_entry_price) throw new Error(`position_initial_entry_price not defined`)
        await context._add_sell_order_at_percentage_above_price({
          symbol: event.symbol,
          exchange_identifier: event.exchange_identifier,
          percentage_to_sell: new BigNumber(amount_percentage),
          percentage_price_increase_to_sell_at: new BigNumber(price_percentage),
          position_initial_entry_price: new BigNumber(event.position_initial_entry_price),
          position_size: new BigNumber(event.position_base_size),
        })
        this.send_message(`Created ${amount_percentage}@${price_percentage} sell order on ${event.symbol}`)
      } catch (e) {
        this.send_message(`Error creating ${amount_percentage}@${price_percentage} sell order on ${event.symbol}`)
        console.log(e)
        Sentry.captureException(e)
      }
      // TODO: tag these orders somewhere as being auto-exit orders
    }

    await sell_x_at_x(this, "10", "10")
    await sell_x_at_x(this, "15", "15")
    await sell_x_at_x(this, "30", "28")
  }

  async shutdown_streams() {
    if (this.positions_listener) this.positions_listener.shutdown_streams()
  }
}

var { argv } = require("yargs")
  .usage("Usage: $0 --live")
  .example("$0 --live")
  // '--live'
  .boolean("live")
  .describe("live", "Trade with real money")
  .default("live", false)
let { live } = argv

var auto_position_exits: AutoPositionExits

async function main() {
  var ee: GenericExchangeInterface
  if (live) {
    logger.info("Live monitoring mode")
    if (!process.env.APIKEY) throw new Error(`APIKEY not defined`)
    if (!process.env.APISECRET) throw new Error(`APISECRET not defined`)
    ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET,
      // getTime: xxx // time generator function, optional, defaults to () => Date.now()
    })
  } else {
    logger.info("Emulated trading mode")
    const fs = require("fs")
    const exchange_info = JSON.parse(fs.readFileSync("./test/exchange_info.json", "utf8"))
    let ee_config = {
      starting_balances: {
        USDT: new BigNumber("50"),
      },
      logger,
      exchange_info,
    }
    ee = new ExchangeEmulator(ee_config)
  }

  const execSync = require("child_process").execSync
  execSync("date -u")

  let auto_position_exits = new AutoPositionExits({
    ee,
    send_message,
    logger,
  })

  auto_position_exits.main().catch((error) => {
    Sentry.captureException(error)
    if (error.name && error.name === "FetchError") {
      logger.error(`${error.name}: Likely unable to connect to Binance and/or Telegram: ${error}`)
    } else {
      logger.error(`Error in main loop: ${error}`)
      logger.error(error)
      logger.error(`Error in main loop: ${error.stack}`)
      send_message(`Error in main loop: ${error}`)
    }
    soft_exit(1)
  })
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
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`)
  if (exit_code) process.exitCode = exit_code
  if (auto_position_exits) auto_position_exits.shutdown_streams()
  logger.warn(`Do we need to close the Binance object?`)
  // if (redis) redis.quit();
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
