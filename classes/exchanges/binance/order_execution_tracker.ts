import { strict as assert } from "assert"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { OrderState } from "../../persistent_state/redis_order_state"

import { Logger } from "../../../interfaces/logger"
import { OrderCallbacks, BinanceOrderData } from "../../../interfaces/order_callbacks"

import * as Sentry from "@sentry/node"
import { Binance, ExecutionReport, UserDataStreamEvent } from "binance-api-node"
import { RedisClient } from "redis"
import { OrderToEdgeMapper } from "../../persistent_state/order-to-edge-mapper"
import { AuthorisedEdgeType } from "../../../events/shared/position-identifier"

export class OrderExecutionTracker {
  send_message: Function
  logger: Logger
  ee: Binance
  closeUserWebsocket: Function | undefined
  order_state: OrderState | undefined
  order_callbacks: OrderCallbacks | undefined
  print_all_trades: boolean = false
  order_to_edge_mapper: OrderToEdgeMapper | undefined

  // All numbers are expected to be passed in as strings
  constructor({
    ee, // binance-api-node API
    send_message,
    logger,
    order_state,
    order_callbacks,
    print_all_trades,
    redis,
  }: {
    ee: Binance
    send_message: (msg: string) => void
    logger: Logger
    order_state?: OrderState
    order_callbacks?: OrderCallbacks
    print_all_trades?: boolean
    redis?: RedisClient
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.order_state = order_state
    this.order_callbacks = order_callbacks
    assert(ee)
    this.ee = ee
    if (print_all_trades) this.print_all_trades = true

    this.logger.warn(`Not type checking BinanceOrderData when casting`)

    process.on("exit", () => {
      this.shutdown_streams()
    })

    if (redis) {
      this.order_to_edge_mapper = new OrderToEdgeMapper({ logger, redis })
      this.logger.info(`Initialised OrderToEdgeMapper`)
    } else {
      this.logger.warn(`No OrderToEdgeMapper available`)
    }
  }

  async main() {
    try {
      await this.monitor_user_stream()
    } catch (error) {
      Sentry.captureException(error)
      this.logger.error(error)
      throw error
    }
  }

  shutdown_streams() {
    if (this.closeUserWebsocket) this.logger.info(`Shutting down streams`)
    if (this.closeUserWebsocket) this.closeUserWebsocket()
  }

  async monitor_user_stream() {
    this.closeUserWebsocket = await this.ee.ws.user(async (_data: UserDataStreamEvent) => {
      let data: ExecutionReport = _data as ExecutionReport
      try {
        const { eventType } = data
        if (eventType !== "executionReport") {
          return
        }
        this.processExecutionReport(data)
      } catch (error) {
        Sentry.withScope(function (scope) {
          scope.setTag("operation", "processExecutionReport")
          scope.setTag("market_symbol", data.symbol)
          scope.setTag("side", data.side)
          scope.setTag("orderType", data.orderType)
          scope.setTag("orderStatus", data.orderStatus)
          scope.setTag("executionType", data.executionType)
          scope.setTag("orderId", data.orderId.toString())
          Sentry.captureException(error)
        })
        let msg = `SHIT: error calling processExecutionReport for pair ${data.symbol}`
        this.logger.error(msg)
        this.logger.error(error)
        this.send_message(msg)
      }
    })
  }

  async get_edge_for_order(data: BinanceOrderData): Promise<AuthorisedEdgeType | undefined> {
    let edge = undefined
    try {
      if (!this.order_to_edge_mapper)
        throw new Error(`OrderToEdgeMapper not initialised, maybe redis was down at startup`)
      edge = await this.order_to_edge_mapper.get_edge_for_order(data.orderId)
    } catch (error) {
      this.logger.warn(error)
      // Non fatal there are valid times for this
      Sentry.captureException(error)
    }
    this.logger.info(`Loaded edge for order ${data.orderId}: ${edge} (undefined/unknown can be valid here)`)
    return undefined
  }

  async processExecutionReport(data: any) {
    const {
      symbol,
      price,
      quantity,
      side,
      orderType,
      orderId,
      orderStatus,
      orderRejectReason,
      totalTradeQuantity,
      totalQuoteTradeQuantity,
    } = data as BinanceOrderData
    // How can I automagically check an input matches the expected type?

    try {
      // Average price can be found by doing totalQuoteTradeQuantity (Z) divided by totalTradeQuantity (z).
      // https://binance-docs.github.io/apidocs/spot/en/#payload-balance-update
      if (totalQuoteTradeQuantity && totalTradeQuantity)
        data.averageExecutionPrice = new BigNumber(totalQuoteTradeQuantity).div(totalTradeQuantity).toFixed(8)
    } catch (error) {
      this.logger.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("operation", "processExecutionReport")
        scope.setTag("pair", symbol)
        if (orderId) scope.setTag("orderId", orderId.toString())
        Sentry.captureException(error)
      })
    }

    let edge: AuthorisedEdgeType | undefined
    try {
      /** Add edge if known */
      edge = await this.get_edge_for_order(data)
      data.edge = edge
    } catch (error) {
      this.logger.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("operation", "processExecutionReport")
        scope.setTag("pair", symbol)
        if (orderId) scope.setTag("orderId", orderId.toString())
        Sentry.captureException(error)
      })
    }

    try {
      if (this.print_all_trades) {
        this.logger.info(`${symbol} ${side} ${orderType} ORDER #${orderId} (${orderStatus})`)
        this.logger.info(
          `..price: ${price}, quantity: ${quantity}, averageExecutionPrice: ${data.averageExecutionPrice}`
        )
      }

      if (orderStatus === "NEW") {
        // Originally orders were all first added here but as we re-architect they will become
        // more likely to pre-exist
        if (this.order_state) await this.order_state.add_new_order(orderId, { symbol, side, orderType })
        if (this.order_callbacks && this.order_callbacks.order_created)
          await this.order_callbacks.order_created(data)
        return
      }

      if (orderStatus === "PARTIALLY_FILLED") {
        if (this.order_state)
          await this.order_state.set_total_executed_quantity(
            orderId,
            new BigNumber(totalTradeQuantity),
            false,
            orderStatus
          )
        if (this.order_callbacks && this.order_callbacks.order_filled_or_partially_filled)
          await this.order_callbacks.order_filled_or_partially_filled(data)
        return
      }

      if (orderStatus === "CANCELED" /*&& orderRejectReason === "NONE"*/) {
        // `Order was cancelled, presumably by user. Exiting.`, (orderRejectReason === "NONE happens when user cancelled)
        if (this.order_state)
          await this.order_state.set_order_cancelled(orderId, true, orderRejectReason, orderStatus)
        if (this.order_callbacks && this.order_callbacks.order_cancelled)
          await this.order_callbacks.order_cancelled(data)
        return
      }

      // EXPIRED can happen on OCO orders when the other side hits or if a token is de-listed
      if (orderStatus === "EXPIRED") {
        if (this.order_callbacks && this.order_callbacks.order_expired)
          await this.order_callbacks.order_expired(data)
        return
      }

      if (orderStatus !== "FILLED") {
        throw new Error(`Unexpected orderStatus: ${orderStatus}. Reason: ${data.r}`)
      }

      if (this.order_state)
        await this.order_state.set_total_executed_quantity(
          orderId,
          new BigNumber(totalTradeQuantity),
          true,
          orderStatus
        )
      if (this.order_callbacks && this.order_callbacks.order_filled_or_partially_filled)
        await this.order_callbacks.order_filled_or_partially_filled(data)
      if (this.order_callbacks) await this.order_callbacks.order_filled(data)
    } catch (error) {
      this.logger.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("operation", "processExecutionReport")
        scope.setTag("pair", symbol)
        if (edge) scope.setTag("edge", edge)
        if (orderId) scope.setTag("orderId", orderId.toString())
        Sentry.captureException(error)
      })
      throw error
    }
  }

  // Event Listeners
  async newOrderId() {
    // we might have orphaned data matching an order, when we get this event
    // we check to see if that has happened and copy the data accross. This mitigates
    // the case where the binance stream sends out a completed order before the orderId
    // is associated with the trade
    // ED: using custom orderIds is a better solution to this
  }

  // Event publishers
  async orderPartialExecution() {}
  async orderCompletedExecution() {} // includes cancelled?
  async orderCancelled() {} // includes cancelled?
}
