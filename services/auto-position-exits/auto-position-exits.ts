#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "auto-position-exits"
const routing_key = "binance"

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

process.on("unhandledRejection", (error) => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import Binance from "binance-api-node"
import { ExchangeInfo } from "binance-api-node"

import { PositionsListener } from "../../classes/amqp/positions-listener"
import { NewPositionEvent } from "../../events/position-events"
import { ExchangeEmulator } from "../../lib/exchange_emulator"
import { GenericOCOOrder, MarketUtils } from "../../interfaces/exchange/generic/market-utils"
import { createMarketUtils } from "../../classes/exchanges/factories/market-utils"

type GenericExchangeInterface = {
  exchangeInfo: () => Promise<ExchangeInfo>
}

export class AutoPositionExits {
  ee: GenericExchangeInterface
  logger: Logger
  send_message: (msg: string) => void
  positions_listener: PositionsListener

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
  }

  async main() {
    if (this.positions_listener) return
    this.positions_listener = new PositionsListener({
      logger: this.logger,
      send_message: this.send_message,
      exchange: routing_key,
      callbacks: this,
    })
    return this.positions_listener.connect()
  }

  async _add_stop_limit_order_at_percentage_below_price({
    market_utils,
    position_initial_entry_price,
    base_asset_quantity,
    percentage_price_decrease_to_sell_at,
  }: {
    market_utils: MarketUtils
    position_initial_entry_price: BigNumber
    base_asset_quantity: BigNumber
    percentage_price_decrease_to_sell_at: BigNumber
  }) {
    let stop_price = position_initial_entry_price.times(
      new BigNumber(100).minus(percentage_price_decrease_to_sell_at).dividedBy(100)
    )
    this.logger.info(
      `Creating stop limit sell: ${await market_utils.market_symbol()}, ${base_asset_quantity.toFixed()} at price ${stop_price.toFixed()}`
    )
    await market_utils.create_stop_limit_sell_order({
      stop_price,
      base_asset_quantity,
    })
  }

  async _add_oco_order_at_percentage_above_price_with_stop_loss({
    market_utils,
    position_initial_entry_price,
    position_size,
    percentage_to_sell,
    percentage_price_increase_to_sell_at,
    stop_percentage,
  }: {
    market_utils: MarketUtils
    position_initial_entry_price: BigNumber
    position_size: BigNumber
    percentage_to_sell: BigNumber
    percentage_price_increase_to_sell_at: BigNumber
    stop_percentage: BigNumber
  }): Promise<GenericOCOOrder> {
    let sell_quantity = position_size.times(percentage_to_sell.dividedBy(100))
    let sell_price = position_initial_entry_price.times(
      percentage_price_increase_to_sell_at.dividedBy(100).plus(1)
    )
    let stop_factor = new BigNumber(100).minus(stop_percentage).dividedBy(100)
    let stop_trigger_price = position_initial_entry_price.times(stop_factor)
    this.logger.info(
      `Creating oco order: ${await market_utils.market_symbol()}, target price ${sell_price.toFixed()}, stop price ${stop_trigger_price.toFixed()}`
    )
    return await market_utils.create_oco_order({
      target_price: sell_price,
      stop_price: stop_trigger_price,
      base_asset_quantity: sell_quantity,
    })
  }

  async new_position_event_callback(event: NewPositionEvent) {
    assert(event.event_type === "NewPositionEvent")
    this.logger.info(event)

    if (!event.position_initial_entry_price) {
      this.send_message(
        `${event.baseAsset} NewPositionEvent missing position_initial_entry_price, skipping auto exit orders`
      )
      return
    }

    try {
      let market_utils = await createMarketUtils({
        logger: this.logger,
        market_identifier: {
          exchange_identifier: event.exchange_identifier,
          base_asset: event.baseAsset,
          quote_asset: event.position_initial_quoteAsset,
        },
      })

      async function sell_x_at_x_with_stop({
        market_utils,
        context,
        amount_percentage,
        price_percentage,
        stop_percentage,
      }: {
        market_utils: MarketUtils
        context: AutoPositionExits
        amount_percentage: string
        price_percentage: string
        stop_percentage: string
      }) {
        try {
          if (!event.position_initial_entry_price) throw new Error(`position_initial_entry_price not defined`)
          context.send_message(
            `Creating ${amount_percentage}@${price_percentage} sell order on ${event.baseAsset}`
          )
          return await context._add_oco_order_at_percentage_above_price_with_stop_loss({
            market_utils,
            percentage_to_sell: new BigNumber(amount_percentage),
            percentage_price_increase_to_sell_at: new BigNumber(price_percentage),
            position_initial_entry_price: new BigNumber(event.position_initial_entry_price),
            position_size: new BigNumber(event.position_base_size),
            stop_percentage: new BigNumber(stop_percentage),
          })
        } catch (e) {
          context.send_message(
            `ERROR could not create ${amount_percentage}@${price_percentage} sell order on ${event.baseAsset}`
          )
          console.error(e)
          Sentry.captureException(e)
          throw e
        }
        // TODO: tag these orders somewhere as being auto-exit orders
      }

      let stop_percentage = "25"
      let remaining_position_size = new BigNumber(event.position_base_size)
      try {
        // catch on these more complex orders separately so we still set the main stop loss exit even if they fail
        let oco_order = await sell_x_at_x_with_stop({
          context: this,
          amount_percentage: "20",
          price_percentage: "20",
          stop_percentage,
          market_utils,
        })
        if (oco_order) {
          remaining_position_size = remaining_position_size.minus(oco_order.base_asset_quantity)
        }
      } catch (err) {
        this.send_message(`ERROR while creating x_at_x auto-exit orders on ${event.baseAsset}`)
        console.error(err)
        Sentry.captureException(err)
      }
      // TODO: await associate_orders_with_position(...) // new class PositionUtils could do this - makes a MarketUtils, adds the order and then adds the association
      await this._add_stop_limit_order_at_percentage_below_price({
        market_utils,
        position_initial_entry_price: new BigNumber(event.position_initial_entry_price),
        base_asset_quantity: remaining_position_size,
        percentage_price_decrease_to_sell_at: new BigNumber(stop_percentage),
      })
    } catch (err) {
      this.send_message(`ERROR while creating auto-exit orders on ${event.baseAsset}`)
      console.error(err)
      Sentry.captureException(err)
      throw err
    }
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
