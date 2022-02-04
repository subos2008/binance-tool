import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import * as Sentry from "@sentry/node"
import { strict as assert } from "assert"

import { RedisClient } from "redis"
import { Logger } from "../../interfaces/logger"
import { GenericOrderData } from "../../types/exchange_neutral/generic_order_data"
import { PositionPublisher } from "../../classes/amqp/positions-publisher"
import { OrderToEdgeMapper } from "../../classes/persistent_state/order-to-edge-mapper"
import {
  AuthorisedEdgeType,
  check_edge,
  SpotPositionIdentifier_V3,
  SpotPositionsQuery_V3,
} from "../../classes/spot/abstractions/position-identifier"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import { SpotPosition } from "../../classes/spot/abstractions/spot-position"
import { SpotPositionsPersistance } from "../../classes/spot/persistence/interface/spot-positions-persistance"

type check_func = ({
  volume,
  price,
  market_symbol,
}: {
  price: BigNumber
  volume: BigNumber
  market_symbol: string
}) => boolean

export class SpotPositionTracker {
  send_message: Function
  logger: Logger
  position_publisher: PositionPublisher
  close_position_check_func: check_func
  order_to_edge_mapper: OrderToEdgeMapper
  spot_positions_query: SpotPositionsQuery
  spot_positions_persistance: SpotPositionsPersistance

  constructor({
    send_message,
    logger,
    redis,
    close_position_check_func,
    spot_positions_query,
    spot_positions_persistance,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    redis: RedisClient
    close_position_check_func: check_func
    spot_positions_query: SpotPositionsQuery
    spot_positions_persistance: SpotPositionsPersistance
  }) {
    assert(logger, "logger not set")
    this.logger = logger
    assert(send_message, "send_message not set")
    this.send_message = send_message
    this.spot_positions_query = spot_positions_query
    this.position_publisher = new PositionPublisher({
      logger,
      send_message,
      broker_name: "binance",
    })
    assert(close_position_check_func, "close_position_check_func not set")
    this.close_position_check_func = close_position_check_func
    this.order_to_edge_mapper = new OrderToEdgeMapper({ logger, redis })
    this.spot_positions_persistance = spot_positions_persistance
  }

  async buy_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let {
      exchange_identifier,
      baseAsset,
      quoteAsset,
      averageExecutionPrice,
      totalBaseTradeQuantity,
      totalQuoteTradeQuantity,
      orderTime,
    } = generic_order_data

    let position = await this.load_position_for_order(generic_order_data)
    position.add_order_to_position({ generic_order_data }) // this would have created it if it didn't exist - from the order data

    if (!averageExecutionPrice) {
      throw new Error(`averageExecutionPrice not defined, unable to publish NewPositionEvent`)
    }
    // Publish an event declaring the new position
    try {
      this.position_publisher.publish_new_position_event({
        event_type: "NewPositionEvent",
        exchange_identifier: position.position_identifier.exchange_identifier,
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
        scope.setTag("exchange", exchange_identifier.exchange)
        scope.setTag("account", exchange_identifier.account)
        Sentry.captureException(error)
      })
    }
  }

  private async load_position_for_order(generic_order_data: GenericOrderData): Promise<SpotPosition> {
    let { baseAsset, orderId } = generic_order_data

    let edge: AuthorisedEdgeType | undefined
    try {
      /* We can expect this to error, certainly initally as we have stops already open,
      Any manually created orders will also throw here */
      edge = await this.order_to_edge_mapper.get_edge_for_order(orderId)
    } catch (error: any) {
      this.logger.warn(`Exception determining edge for orderId ${orderId}: ${error.toString()}`)
    }

    let position_identifier: SpotPositionIdentifier_V3 = {
      exchange_identifier: generic_order_data.exchange_identifier,
      base_asset: baseAsset,
      edge: check_edge(edge),
    }
    return this.spot_positions_query.position(position_identifier)
  }

  async sell_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let { baseAsset, quoteAsset, market_symbol, averageExecutionPrice } = generic_order_data

    let position = await this.load_position_for_order(generic_order_data)
    this.logger.info(position)

    // 1. Is this an existing position?
    if ((await position.position_size()).isZero()) {
      this.send_message(`Sell executed on unknown position for ${baseAsset}`)
      return // this is our NOP
    }

    // 1.2 if existing position decrease the position size or close the position

    // TODO: the code in autoexits that calls MarketUtils could call onto a position. Would be good on a position
    // to have one call to move the stops on all orders up at once. Position.move_all_stops_to(stop_price)
    await position.add_order_to_position({ generic_order_data })

    this.logger.info(`Added order to position for ${baseAsset}`)

    if (!averageExecutionPrice) {
      // TODO: set sentry context after unpacking the order (withScope)
      let msg = `averageExecutionPrice not supplied, unable to determine if ${baseAsset} position should be closed.`
      Sentry.captureMessage(msg)
      this.send_message(msg)
      return
    }

    // 1.3 see if we should close the position
    if (
      this.close_position_check_func({
        market_symbol,
        volume: await position.position_size(),
        price: new BigNumber(averageExecutionPrice),
      })
    ) {
      await this.spot_positions_persistance.delete_position(position.position_identifier)
      this.send_message(`closed position: ${position.baseAsset} to ${quoteAsset}`)
    }
  }
}
