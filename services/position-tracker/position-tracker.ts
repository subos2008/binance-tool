import { strict as assert } from "assert"

import { RedisClient } from "redis"

import { Logger } from "../../interfaces/logger"
import { GenericOrderData } from "../../types/exchange_neutral/generic_order_data"
import { RedisPositionsState } from "../../classes/persistent_state/redis_positions_state"
import { PositionPublisher } from "../../classes/amqp/positions-publisher"

import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import * as Sentry from "@sentry/node"
import { PositionIdentifier } from "../../events/shared/position-identifier"
import { Position } from "../../classes/position"

type check_func = ({
  volume,
  price,
  market_symbol,
}: {
  price: BigNumber
  volume: BigNumber
  market_symbol: string
}) => boolean

export class PositionTracker {
  send_message: Function
  logger: Logger
  positions_state: RedisPositionsState
  position_publisher: PositionPublisher
  close_position_check_func: check_func

  constructor({
    send_message,
    logger,
    redis,
    close_position_check_func,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    redis: RedisClient
    close_position_check_func: check_func
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.positions_state = new RedisPositionsState({ logger, redis })
    this.position_publisher = new PositionPublisher({
      logger,
      send_message,
      broker_name: "binance",
    })
    assert(close_position_check_func)
    this.close_position_check_func = close_position_check_func
  }

  async buy_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let {
      baseAsset,
      quoteAsset,
      exchange,
      account,
      averageExecutionPrice,
      totalBaseTradeQuantity,
      totalQuoteTradeQuantity,
      orderTime,
    } = generic_order_data

    let position = await this.load_position_for_order(generic_order_data)
    position.add_order_to_position({ generic_order_data })

    if (!averageExecutionPrice) {
      throw new Error(`averageExecutionPrice not defined, unable to publish NewPositionEvent`)
    }
    // Publish an event declaring the new position
    try {
      this.position_publisher.publish_new_position_event({
        event_type: "NewPositionEvent",
        exchange_identifier: position.tuple,
        baseAsset,
        position_base_size: totalBaseTradeQuantity,
        position_initial_quote_spent: totalQuoteTradeQuantity,
        position_initial_quoteAsset: quoteAsset,
        position_initial_entry_price: averageExecutionPrice,
        position_entry_timestamp_ms: orderTime,
      })
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", baseAsset)
        scope.setTag("exchange", exchange)
        if (account) scope.setTag("account", account)
        Sentry.captureException(error)
      })
    }
  }

  private async load_position_for_order(generic_order_data: GenericOrderData): Promise<Position> {
    let { baseAsset, exchange, account, averageExecutionPrice } = generic_order_data

    if (!account) account = "default" // TODO
    let position_identifier: PositionIdentifier = {
      exchange_identifier: { exchange, account },
      baseAsset,
    }
    let position = new Position({
      logger: this.logger,
      redis_positions: this.positions_state,
      position_identifier,
    })
    let prices: { [key: string]: string } = {}
    if (averageExecutionPrice) prices[baseAsset] = averageExecutionPrice
    return position
  }

  async sell_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let { baseAsset, quoteAsset, market_symbol, averageExecutionPrice } = generic_order_data

    let position = await this.load_position_for_order(generic_order_data)

    // 1. Is this an existing position?
    if ((await position.position_size()).isZero()) {
      this.send_message(`Sell executed on unknown position for ${baseAsset}`)
      return // this is our NOP
    }

    // 1.2 if existing position decrease the position size or close the position

    // TODO: the code in autoexits that calls MarketUtils could call onto a position. Would be good on a position
    // to have one call to move the stops on all orders up at once. Position.move_all_stops_to(stop_price)
    await position.add_order_to_position({ generic_order_data })

    let msg = `reduced the position size for ${baseAsset}`
    this.send_message(msg)

    if (!averageExecutionPrice) {
      // TODO: set sentry context after unpacking the order (withScope)
      let msg = `averageExecutionPrice not supplied, unable to determine if ${baseAsset} position should be closed.`
      Sentry.captureMessage(msg)
      this.send_message(msg)
      return
    }

    // 1.3
    if (
      this.close_position_check_func({
        market_symbol,
        volume: await position.position_size(),
        price: new BigNumber(averageExecutionPrice),
      })
    ) {
      await position.close()
      this.send_message(`closed position: ${position.baseAsset} to ${quoteAsset}`)
    }
  }
}
