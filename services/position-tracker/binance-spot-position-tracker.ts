#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"
const service_name = "binance-position-tracker"
import { fromCompletedBinanceOrderData } from "../../interfaces/exchange/binance/spot-orders"
import { is_too_small_to_trade } from "../../lib/utils"

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

process.on("unhandledRejection", (error) => {
  logger.error(error)
  Sentry.captureException(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import { get_redis_client, set_redis_logger } from "../../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()

import { OrderExecutionTracker } from "../../classes/exchanges/binance/order_execution_tracker"
import { BinanceOrderData, OrderCallbacks } from "../../interfaces/order_callbacks"
import { SpotPositionTracker } from "./position-tracker"

import BinanceFoo from "binance-api-node"
import { Binance } from "binance-api-node"
import { ExchangeInfo } from "binance-api-node"
import { SpotPositionsPersistance } from "../../classes/spot/persistence/interface/spot-positions-persistance"
import { SpotRedisPositionsState } from "../../classes/spot/persistence/redis-implementation/spot-redis-positions-state-v3"
import { BinanceSpotExecutionEngine } from "../../classes/spot/exchanges/binance/binance-spot-execution-engine"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import { RedisInterimSpotPositionsMetaDataPersistantStorage } from "../spot-trade-abstraction/interim-meta-data-storage"

let order_execution_tracker: OrderExecutionTracker | null = null

class MyOrderCallbacks implements OrderCallbacks {
  send_message: Function
  logger: Logger
  position_tracker: SpotPositionTracker
  exchange_info: ExchangeInfo

  constructor({
    send_message,
    logger,
    position_tracker,
    exchange_info,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    position_tracker: SpotPositionTracker
    exchange_info: ExchangeInfo
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    assert(position_tracker)
    this.position_tracker = position_tracker
    this.exchange_info = exchange_info
  }

  async order_filled(data: BinanceOrderData): Promise<void> {
    let exchange_info = this.exchange_info
    if (data.side == "BUY") {
      this.logger.info(`BUY order on ${data.symbol} filled (edge: ${data.edge}).`)
      this.position_tracker.buy_order_filled({
        generic_order_data: fromCompletedBinanceOrderData(data, exchange_info),
      })
    }
    if (data.side == "SELL") {
      this.logger.info(`SELL order on ${data.symbol} filled (edge: ${data.edge}).`)
      this.position_tracker.sell_order_filled({
        generic_order_data: fromCompletedBinanceOrderData(data, exchange_info),
      })
    }
  }
}

let position_tracker: SpotPositionTracker

async function main() {
  const ee = new BinanceSpotExecutionEngine({ logger })
  let exchange_info = await ee.get_exchange_info() // TODO: should update this every now and then

  // return true if the position size passed it would be considered an untradeably small balance on the exchange
  let close_position_check_func = function ({
    market_symbol,
    volume,
    price,
  }: {
    market_symbol: string
    volume: BigNumber
    price: BigNumber
  }): boolean {
    let result: boolean = is_too_small_to_trade({ symbol: market_symbol, volume, exchange_info, price })
    console.log(
      `Checking if ${volume.toFixed()} ${market_symbol} would be too small to trade (result=${
        result ? "yes" : "no"
      })`
    )
    return result
  }
  const interim_spot_positions_metadata_persistant_storage =
    new RedisInterimSpotPositionsMetaDataPersistantStorage({
      logger,
      redis,
    })
  const spot_positions_persistance: SpotPositionsPersistance = new SpotRedisPositionsState({ logger, redis })
  const spot_positions_query = new SpotPositionsQuery({
    logger,
    positions_persistance: spot_positions_persistance,
    send_message,
    exchange_identifier: ee.get_exchange_identifier(),
    interim_spot_positions_metadata_persistant_storage,
  })

  position_tracker = new SpotPositionTracker({
    logger,
    send_message,
    redis,
    close_position_check_func,
    spot_positions_query,
    spot_positions_persistance,
  })

  // await publisher.connect()

  // Update when any order completes
  let order_callbacks = new MyOrderCallbacks({ logger, send_message, position_tracker, exchange_info })
  order_execution_tracker = new OrderExecutionTracker({
    ee: ee.get_raw_binance_ee(),
    send_message,
    logger,
    order_callbacks,
    redis,
  })
  order_execution_tracker
    .main()
    .catch((error) => {
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
