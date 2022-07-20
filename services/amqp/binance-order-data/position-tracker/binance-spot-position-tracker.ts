#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"
const service_name = "binance-position-tracker"
import { fromCompletedBinanceOrderData } from "../../../../interfaces/exchanges/binance/spot-orders"
import { is_too_small_to_trade } from "../../../../lib/utils"

require("dotenv").config()

let account = "default"

import Sentry from "../../../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../../../lib/faux_logger"
const logger: Logger = new Logger({ silent: false })

import { SendMessage, SendMessageFunc } from "../../../../classes/send_message/publish"
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
})

import { get_redis_client, set_redis_logger } from "../../../../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()

import binance, { Binance, ExchangeInfo } from "binance-api-node"
import { BinanceOrderData, OrderCallbacks } from "../../../../interfaces/exchanges/binance/order_callbacks"
import { SpotPositionTracker } from "./position-tracker"
import { SpotPositionsPersistance } from "../../../../classes/spot/persistence/interface/spot-positions-persistance"
import { RedisSpotPositionsPersistance } from "../../../../classes/spot/persistence/redis-implementation/redis-spot-positions-persistance-v3"
import { SpotPositionsQuery } from "../../../../classes/spot/abstractions/spot-positions-query"
import { RedisOrderContextPersistance } from "../../../../classes/persistent_state/redis-implementation/redis-order-context-persistence"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { AMQP_BinanceOrderDataListener } from "../../../../classes/exchanges/binance/amqp-binance-order-data-listener"
import { BinanceExchangeInfoGetter } from "../../../../classes/exchanges/binance/exchange-info-getter"

let order_execution_tracker: AMQP_BinanceOrderDataListener | null = null

class MyOrderCallbacks implements OrderCallbacks {
  send_message: SendMessageFunc
  logger: Logger
  position_tracker: SpotPositionTracker
  exchange_info: ExchangeInfo

  constructor({
    send_message,
    logger,
    position_tracker,
    exchange_info,
  }: {
    send_message: SendMessageFunc
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
      this.logger.info(data, `BUY order on ${data.symbol} filled (edge: ${data.edge}).`)
      this.position_tracker.buy_order_filled({
        generic_order_data: fromCompletedBinanceOrderData(data, exchange_info),
      })
    }
    if (data.side == "SELL") {
      this.logger.info(data, `SELL order on ${data.symbol} filled (edge: ${data.edge}).`)
      this.position_tracker.sell_order_filled({
        generic_order_data: fromCompletedBinanceOrderData(data, exchange_info),
      })
    }
  }
}

let position_tracker: SpotPositionTracker

async function main() {
  assert(process.env.BINANCE_API_KEY)
  assert(process.env.BINANCE_API_SECRET)
  const ee: Binance = binance({
    apiKey: process.env.BINANCE_API_KEY || "foo",
    apiSecret: process.env.BINANCE_API_SECRET || "foo",
  })
  const exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
  let exchange_info = await exchange_info_getter.get_exchange_info() // TODO: should update this every now and then
  let exchange_identifier = exchange_info_getter.get_exchange_identifier()

  const health_and_readiness = new HealthAndReadiness({ logger, send_message })

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
  const spot_positions_persistance: SpotPositionsPersistance = new RedisSpotPositionsPersistance({ logger, redis })
  const spot_positions_query = new SpotPositionsQuery({
    logger,
    positions_persistance: spot_positions_persistance,
    send_message,
    exchange_identifier: {
      ...exchange_identifier,
      account,
      version: "v3",
      type: exchange_identifier.exchange_type,
    },
  })

  position_tracker = new SpotPositionTracker({
    logger,
    send_message,
    redis,
    close_position_check_func,
    spot_positions_query,
    spot_positions_persistance,
    health_and_readiness,
  })

  // await publisher.connect()

  // Update when any order completes
  let order_callbacks = new MyOrderCallbacks({ logger, send_message, position_tracker, exchange_info })
  order_execution_tracker = new AMQP_BinanceOrderDataListener({
    send_message,
    logger,
    health_and_readiness,
    service_name,
    order_callbacks,
  })

  await order_execution_tracker.start()
}

main().catch((err) => {
  Sentry.captureException(err)
  logger.error(`Error in main loop: ${err}`)
  logger.error({ err })
  logger.error(`Error in main loop: ${err.stack}`)
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
