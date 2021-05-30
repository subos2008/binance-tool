#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"
const service_name = "ftx-position-tracker"
import { fromCompletedFtxOrderData } from "../../interfaces/exchange/ftx/orders"
import { is_too_small_to_trade } from "../../lib/utils"

require("dotenv").config()

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

import { FtxWebsocketClient } from "../../classes/exchanges/ftx/websocket-client"
import { RestClient, FtxMarket } from "../../classes/exchanges/ftx/rest-client"

import { FtxOrderExecutionTracker } from "../../classes/exchanges/ftx/order_execution_tracker"
import { PositionTracker } from "./position-tracker"
import { FtxOrderWsEvent, FtxOrderCallbacks, FtxWsOrderData } from "../../interfaces/exchange/ftx/orders"

import { get_redis_client, set_redis_logger } from "../../lib/redis"
import { ExchangeIdentifier } from "../../events/shared/exchange-identifier"
import { FtxExchangeUtils } from "../../classes/exchanges/ftx/exchange-utils"
import { ExchangeUtils } from "../../interfaces/exchange/generic/exchange-utils"

set_redis_logger(logger)
const redis = get_redis_client()

let order_execution_tracker: FtxOrderExecutionTracker | null = null

class MyOrderCallbacks implements FtxOrderCallbacks {
  send_message: Function
  logger: Logger
  position_tracker: PositionTracker
  exchange_utils: ExchangeUtils

  constructor({
    send_message,
    logger,
    position_tracker,
    exchange_utils,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    position_tracker: PositionTracker
    exchange_utils: ExchangeUtils
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    assert(position_tracker)
    this.position_tracker = position_tracker
    this.exchange_utils = exchange_utils
  }

  async order_cancelled(order_id: string, data: FtxWsOrderData): Promise<void> {
    // this.logger.info(`${data.side} order on ${data.symbol} cancelled.`)
  }

  async order_filled(order_id: string, data: FtxWsOrderData): Promise<void> {
    // let exchange_info = this.exchange_info
    if (data.side == "buy") {
      this.logger.info(`BUY order on ${data.market} filled.`)
      this.position_tracker.buy_order_filled({
        generic_order_data: fromCompletedFtxOrderData(data, this.exchange_utils),
      })
    }
    if (data.side == "sell") {
      this.logger.info(`SELL order on ${data.market} filled.`)
      this.position_tracker.sell_order_filled({
        generic_order_data: fromCompletedFtxOrderData(data, this.exchange_utils),
      })
    }
  }

  async order_filled_or_partially_filled(order_id: string, data: FtxWsOrderData): Promise<void> {
    // this.logger.info(`${data.side} order on ${data.symbol} filled_or_partially_filled.`)
  }
}

var { argv } = require("yargs")
  .usage("Usage: $0 --live")
  .example("$0 --live")
  // '--live'
  .boolean("live")
  .describe("live", "Trade with real money")
  .default("live", true)
let { live } = argv

// type GenericExchangeInterface = {
//   exchangeInfo: () => Promise<ExchangeInfo>
// }

// let ee: GenericExchangeInterface
let position_tracker: PositionTracker

async function main() {
  if (!live) {
    throw new Error(`Non-live mode not implemented for FTX`)
  }
  logger.info("Live monitoring mode")

  if (!process.env.FTX_RO_APIKEY) throw new Error(`FTX_RO_APIKEY not defined`)
  if (!process.env.FTX_RO_APISECRET) throw new Error(`FTX_RO_APISECRET not defined`)
  // Prepare a ws connection (connection init is automatic once ws client is instanced)
  const params = {
    key: process.env.FTX_RO_APIKEY,
    secret: process.env.FTX_RO_APISECRET,
    // subAccountName: 'sub1',
    // jsonParseFunc: JSON.parse
  }

  const rest = new RestClient(params)
  const markets = await rest.getMarkets()
  const exchange_utils = new FtxExchangeUtils({ markets })

  const ws = new FtxWebsocketClient(params, logger)

  // append event listeners
  ws.on("response", (msg) => logger.info("response: ", msg))
  ws.on("error", (msg) => logger.error("err: ", msg))
  ws.on("update", (msg) => logger.info("update: ", msg))

  const execSync = require("child_process").execSync
  execSync("date -u")

  let close_position_check_func = function ({
    market_symbol,
    volume,
    price,
  }: {
    market_symbol: string // i.e. BTC-USDT
    volume: BigNumber
    price: BigNumber
  }): boolean {
    logger.warn(`close_position_check_func not implemented for ftx`)
    return exchange_utils.is_too_small_to_trade({ market_symbol, volume, price })
  }

  position_tracker = new PositionTracker({
    logger,
    send_message,
    redis,
    close_position_check_func,
  })

  // Update when any order completes
  let order_callbacks = new MyOrderCallbacks({ logger, send_message, position_tracker, exchange_utils })
  order_execution_tracker = new FtxOrderExecutionTracker({
    ws,
    send_message,
    logger,
    order_callbacks,
  })
  order_execution_tracker
    .main()
    .catch((error) => {
      Sentry.captureException(error)
      if (error.name && error.name === "FetchError") {
        logger.error(`${error.name}: Likely unable to connect to FTX: ${error}`)
      } else {
        logger.error(`Error in main loop: ${error}`)
        logger.error(error)
        logger.error(`Error in main loop: ${error.stack}`)
        send_message(`Error in main loop: ${error}`)
      }
      soft_exit(1)
    })
    .then(() => {
      logger.info("order_execution_tracker.main() returned.")
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
  // if (publisher) publisher.shutdown_streams()
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
