import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import Sentry from "../../../../lib/sentry"
import { strict as assert } from "assert"

import { RedisClientType } from "redis-v4"
import { ServiceLogger } from "../../../../interfaces/logger"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { GenericOrderData } from "../../../../types/exchange_neutral/generic_order_data"
import {
  AuthorisedEdgeType,
  SpotPositionIdentifier_V3,
} from "../../../../classes/spot/abstractions/position-identifier"
import { SpotPositionsQuery } from "../../../../classes/spot/abstractions/spot-positions-query"
import { SpotPosition } from "../../../../classes/spot/abstractions/spot-position"
import { SpotPositionsPersistence } from "../../../../classes/spot/persistence/interface/spot-positions-persistance"
import { OrderContextPersistence } from "../../../../classes/persistent_state/interface/order-context-persistence"
import { RedisOrderContextPersistence } from "../../../../classes/persistent_state/redis-implementation/redis-order-context-persistence"
import {
  SpotPositionCallbacks,
  SpotPositionClosed,
  SpotPositionOpenedEvent_V1,
} from "../../../../classes/spot/abstractions/spot-position-callbacks"
import { OrderContext_V1 } from "../../../../interfaces/orders/order-context"
import { ContextTags, SendMessageFunc } from "../../../../interfaces/send-message"

export type check_func = ({
  volume,
  price,
  market_symbol,
}: {
  price: BigNumber
  volume: BigNumber
  market_symbol: string
}) => boolean

export class SpotPositionTracker {
  send_message: SendMessageFunc
  logger: ServiceLogger
  close_position_check_func: check_func
  order_context_persistence: OrderContextPersistence
  spot_positions_query: SpotPositionsQuery
  spot_positions_persistance: SpotPositionsPersistence
  callbacks: SpotPositionCallbacks
  health_and_readiness: HealthAndReadiness

  constructor({
    send_message,
    logger,
    redis,
    close_position_check_func,
    spot_positions_query,
    spot_positions_persistance,
    health_and_readiness,
    callbacks,
  }: {
    send_message: SendMessageFunc
    logger: ServiceLogger
    redis: RedisClientType
    close_position_check_func: check_func
    spot_positions_query: SpotPositionsQuery
    spot_positions_persistance: SpotPositionsPersistence
    health_and_readiness: HealthAndReadiness
    callbacks: SpotPositionCallbacks
  }) {
    this.logger = logger
    this.send_message = send_message
    this.spot_positions_query = spot_positions_query
    assert(close_position_check_func, "close_position_check_func not set")
    this.close_position_check_func = close_position_check_func
    this.order_context_persistence = new RedisOrderContextPersistence({ logger, redis })
    this.spot_positions_persistance = spot_positions_persistance
    this.health_and_readiness = health_and_readiness
    this.callbacks = callbacks
  }

  async get_order_context_for_order(data: GenericOrderData): Promise<OrderContext_V1 | { edge: undefined }> {
    let order_context: OrderContext_V1 | undefined = undefined
    try {
      order_context = await this.order_context_persistence.get_order_context_for_order({
        exchange_identifier: data.exchange_identifier,
        order_id: data.order_id,
      })
    } catch (err) {
      // Non fatal there are valid times for this like manually created orders
      this.logger.exception(data, err)
    }
    return order_context || { edge: undefined }
  }

  async buy_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let { exchange_identifier, baseAsset, averageExecutionPrice, side, orderType, quoteAsset } = generic_order_data
    let { edge } = await this.get_order_context_for_order(generic_order_data)

    let tags: ContextTags = { base_asset: baseAsset, quote_asset: quoteAsset }
    if (edge) tags.edge = edge

    /* TODO: What do we want to do here if edge is undefined? */
    if (!edge) this.logger.warn(`Edge is undefined for order... what whould we do?`)

    let position = await this.load_position_for_order(generic_order_data)
    await position.add_order_to_position({ generic_order_data }) // this would have created it if it didn't exist - from the order data

    if (!averageExecutionPrice) {
      throw new Error(`averageExecutionPrice not defined, unable to publish SpotPositionOpenedEvent`)
    }

    // Publish a new style event declaring the opened position
    try {
      let event = await position.get_SpotPositionOpenedEvent()
      await this.callbacks.on_position_opened(event)
    } catch (err) {
      console.error(err)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", baseAsset)
        scope.setTag("exchange", exchange_identifier.exchange)
        scope.setTag("account", exchange_identifier.account)
        Sentry.captureException(err)
      })
    }
  }

  private async load_position_for_order(generic_order_data: GenericOrderData): Promise<SpotPosition> {
    let { baseAsset, order_id } = generic_order_data

    let edge: string | undefined
    try {
      /* We can expect this to error, certainly initally as we have stops already open,
      Any manually created orders will also throw here */
      let order_context: OrderContext_V1 = await this.order_context_persistence.get_order_context_for_order({
        exchange_identifier: generic_order_data.exchange_identifier,
        order_id,
      })
      edge = order_context.edge
    } catch (err: any) {
      this.logger.warn({ err }, `Exception determining edge for order_id ${order_id}: ${err.message}`)
    }

    let position_identifier: SpotPositionIdentifier_V3 = {
      exchange_identifier: generic_order_data.exchange_identifier,
      base_asset: baseAsset,
      edge: edge as AuthorisedEdgeType,
    }
    return this.spot_positions_query.position(position_identifier)
  }

  async sell_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let { baseAsset, quoteAsset, market_symbol, averageExecutionPrice, side, orderType } = generic_order_data

    let position: SpotPosition = await this.load_position_for_order(generic_order_data)
    // this.logger.info(await position.describe_position(), `Sell order filled on position`)
    let edge = await position.edge()

    let tags = { edge, base_asset: baseAsset, quote_asset: quoteAsset }

    // 1. Is this an existing position?
    if ((await position.position_size()).isZero()) {
      this.send_message(`Sell executed on unknown position for ${baseAsset}`, tags)
      return // this is our NOP
    }

    // 1.2 if existing position decrease the position size or close the position

    // TODO: the code in autoexits that calls MarketUtils could call onto a position. Would be good on a position
    // to have one call to move the stops on all orders up at once. Position.move_all_stops_to(stop_price)
    await position.add_order_to_position({ generic_order_data })

    if (!averageExecutionPrice) {
      // TODO: set sentry context after unpacking the order (withScope)
      // .. really? Can't we use current price as a backup? ..
      let msg = `averageExecutionPrice not supplied, unable to determine if ${baseAsset} position should be closed.`
      Sentry.captureMessage(msg)
      this.send_message(msg, tags)
      return
    }

    // 1.3 see if we should close the position
    // maybe this could be position.is_closed()
    if (
      this.close_position_check_func({
        market_symbol,
        volume: await position.position_size(),
        price: new BigNumber(averageExecutionPrice),
      })
    ) {
      try {
        let event: SpotPositionClosed = await position.get_SpotPositionClosedEvent({
          object_subtype: "SingleEntryExit",
          exit_timestamp_ms: generic_order_data.orderTime,
          exit_executed_price: averageExecutionPrice, // average exit price (actual)
          exit_quote_asset: quoteAsset, // should match initial_entry_quote_asset
          exit_quote_returned: generic_order_data.totalQuoteTradeQuantity, // how much quote did we get when liquidating the position
          exit_position_size: generic_order_data.totalBaseTradeQuantity, // base asset
        })
        this.logger.event(tags, event)
        await this.callbacks.on_position_closed(event)
      } catch (err) {
        let msg = `Failed to create/send SpotPositionClosed for: ${position.baseAsset} to ${quoteAsset}`
        this.send_message(msg, tags)
        this.logger.exception(tags, err, msg)
      }
      await this.spot_positions_persistance.delete_position(position.position_identifier)
      // removed as it was becomming a duplicate; edge performance messages are more useful
      // this.send_message(`closed position: ${position.baseAsset} to ${quoteAsset} (${edge})`, tags)
    }
  }
}
