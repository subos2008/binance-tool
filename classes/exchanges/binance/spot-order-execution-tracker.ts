import { strict as assert } from "assert"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../../interfaces/logger"
import { OrderCallbacks, BinanceOrderData } from "../../../interfaces/exchanges/binance/order_callbacks"

import Sentry from "../../../lib/sentry"
import {
  AccountConfigUpdate,
  AccountUpdate,
  BalanceUpdate,
  Binance,
  ExecutionReport,
  MarginCall,
  OutboundAccountInfo,
  OutboundAccountPosition,
  UserDataStreamEvent,
} from "binance-api-node"
import { AuthorisedEdgeType } from "../../spot/abstractions/position-identifier"
import { ExchangeIdentifier_V3 } from "../../../events/shared/exchange-identifier"
import { OrderContextPersistence } from "../../persistent_state/interface/order-context-persistence"
import { OrderContext_V1 } from "../../../interfaces/orders/order-context"

export class OrderExecutionTracker {
  send_message: Function
  logger: Logger
  ee: Binance
  closeUserWebsocket: Function | undefined
  order_callbacks: OrderCallbacks | undefined
  print_all_trades: boolean = false
  order_context_persistence: OrderContextPersistence
  exchange_identifier: ExchangeIdentifier_V3

  // All numbers are expected to be passed in as strings
  constructor({
    ee, // binance-api-node API
    send_message,
    logger,
    order_callbacks,
    print_all_trades,
    order_context_persistence,
    exchange_identifier,
  }: {
    ee: Binance
    send_message: (msg: string) => void
    logger: Logger
    order_callbacks?: OrderCallbacks
    print_all_trades?: boolean
    order_context_persistence: OrderContextPersistence
    exchange_identifier: ExchangeIdentifier_V3
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.order_callbacks = order_callbacks
    assert(ee)
    this.ee = ee
    if (print_all_trades) this.print_all_trades = true
    this.order_context_persistence = order_context_persistence
    this.exchange_identifier = exchange_identifier

    process.on("exit", () => {
      this.shutdown_streams()
    })
  }

  async main() {
    try {
      await this.monitor_user_stream()
    } catch (err: any) {
      if (err.name && err.name === "FetchError") {
        this.logger.error(`${err.name}: Likely unable to connect to Binance and/or Telegram: ${err}`)
      }
      Sentry.captureException(err)
      this.logger.error({ err })
      throw err
    }
  }

  shutdown_streams() {
    if (this.closeUserWebsocket) this.logger.info(`Shutting down streams`)
    if (this.closeUserWebsocket) this.closeUserWebsocket()
  }

  async monitor_user_stream() {
    type processor_func = (data: ExecutionReport) => Promise<void>

    const process_execution_report: processor_func = async (data: ExecutionReport) => {
      try {
        this.processExecutionReport(data)
      } catch (err) {
        Sentry.withScope(function (scope) {
          scope.setTag("operation", "processExecutionReport")
          scope.setTag("market_symbol", data.symbol)
          scope.setTag("side", data.side)
          scope.setTag("orderType", data.orderType)
          scope.setTag("orderStatus", data.orderStatus)
          scope.setTag("executionType", data.executionType)
          // scope.setTag("order_id", data.newClientOrderId)
          Sentry.captureException(err)
        })
        let msg = `Error calling processExecutionReport for pair ${data.symbol}`
        this.logger.error(data, msg)
        this.logger.error({ err })
        this.send_message(msg)
      }
    }

    switch (this.exchange_identifier.type) {
      case "spot":
        this.closeUserWebsocket = await this.ee.ws.user(
          async (
            data: OutboundAccountInfo | ExecutionReport | BalanceUpdate | OutboundAccountPosition | MarginCall
          ) => {
            this.logger.info(data)
            if (data.eventType === "executionReport") {
              process_execution_report(data)
            }
          }
        )
        break
      default:
        throw new Error(`Unknown exchange type: ${this.exchange_identifier.type}`)
    }
  }

  async get_order_context_for_order(data: BinanceOrderData): Promise<OrderContext_V1> {
    let order_context: OrderContext_V1 | undefined = undefined
    try {
      order_context = await this.order_context_persistence.get_order_context_for_order({
        exchange_identifier: this.exchange_identifier,
        order_id: data.order_id,
      })
      if (!order_context) throw new Error(`No OrderContext found for order ${data.order_id}`)
      let { edge } = order_context
      this.logger.info(
        data,
        `Loaded edge for order ${data.order_id}: ${edge}:${data.symbol} (undefined can be valid here for manually created orders)`
      )
      return order_context
    } catch (err) {
      // Non fatal there are valid times for this like manually created orders
      this.logger.warn(data, err)
      // Sentry.captureException(err)
      throw err
    }
  }

  async processExecutionReport(_data: ExecutionReport) {
    let bod: BinanceOrderData
    if (_data.eventType === "executionReport") {
      const {
        symbol,
        price,
        quantity,
        side,
        orderType,
        orderStatus,
        totalTradeQuantity,
        totalQuoteTradeQuantity,
        newClientOrderId,
        orderId,
        orderListId,
        originalClientOrderId,
      } = _data

      let order_id: string, order_is_is_client_order_id: boolean
      if (newClientOrderId) {
        order_is_is_client_order_id = true
        order_id = newClientOrderId
        console.info(JSON.stringify(_data))
      } else if (originalClientOrderId) {
        order_is_is_client_order_id = true
        order_id = originalClientOrderId
        console.info(JSON.stringify(_data))
      } else {
        this.logger.warn(
          `No newClientOrderId in ExecutionReport, oderId: ${orderId}, orderListId: ${orderListId}`,
          _data
        )
        console.info(JSON.stringify(_data))

        order_is_is_client_order_id = false
        order_id = _data.orderId.toString()
      }

      bod = {
        ..._data,
        object_type: "BinanceOrderData",
        version: 1,
        exchange_identifier: this.exchange_identifier,
        exchange_type: this.exchange_identifier.type,
        order_id,
        order_is_is_client_order_id,
      }

      try {
        // Average price can be found by doing totalQuoteTradeQuantity (Z) divided by totalTradeQuantity (z).
        // https://binance-docs.github.io/apidocs/spot/en/#payload-balance-update
        if (totalQuoteTradeQuantity && totalTradeQuantity)
          bod.averageExecutionPrice = new BigNumber(totalQuoteTradeQuantity).div(totalTradeQuantity).toFixed(8)
      } catch (err) {
        this.logger.error(_data, err)
        Sentry.withScope(function (scope) {
          scope.setTag("operation", "processExecutionReport")
          scope.setTag("pair", symbol)
          scope.setTag("order_id", order_id || "undefined")
          Sentry.captureException(err)
        })
      }

      // This bit of code is horrible
      let edge: AuthorisedEdgeType | undefined
      try {
        /** Add edge and order_context if known */
        let order_context: OrderContext_V1 = await this.get_order_context_for_order(bod)
        bod.order_context = order_context
        bod.edge = order_context.edge
      } catch (err) {
        this.logger.error(_data, err)
        Sentry.withScope(function (scope) {
          scope.setTag("operation", "processExecutionReport")
          scope.setTag("pair", symbol)
          scope.setTag("order_id", order_id || "undefined")
          Sentry.captureException(err)
        })
        edge = "undefined"
      }

      try {
        if (this.print_all_trades) {
          this.logger.info(_data, `${symbol} ${side} ${orderType} ORDER #${order_id} (${orderStatus})`)
          this.logger.info(
            _data,
            `..price: ${price}, quantity: ${quantity}, averageExecutionPrice: ${bod.averageExecutionPrice}`
          )
        }

        if (orderStatus === "NEW") {
          // Originally orders were all first added here but as we re-architect they will become
          // more likely to pre-exist
          if (this.order_callbacks && this.order_callbacks.order_created)
            await this.order_callbacks.order_created(bod)
          return
        }

        if (orderStatus === "PARTIALLY_FILLED") {
          if (this.order_callbacks && this.order_callbacks.order_filled_or_partially_filled)
            await this.order_callbacks.order_filled_or_partially_filled(bod)
          return
        }

        if (orderStatus === "CANCELED" /*&& orderRejectReason === "NONE"*/) {
          // `Order was cancelled, presumably by user. Exiting.`, (orderRejectReason === "NONE happens when user cancelled)
          if (this.order_callbacks && this.order_callbacks.order_cancelled)
            await this.order_callbacks.order_cancelled(bod)
          return
        }

        // EXPIRED can happen on OCO orders when the other side hits or if a token is de-listed
        // Can also happen on IOC limit buys, used to prevent slippage on entry
        if (orderStatus === "EXPIRED") {
          if (this.order_callbacks && this.order_callbacks.order_expired)
            await this.order_callbacks.order_expired(bod)
          return
        }

        if (orderStatus !== "FILLED") {
          throw new Error(`Unexpected orderStatus: ${orderStatus}. Reason: ${bod.orderRejectReason}`)
        }

        if (this.order_callbacks && this.order_callbacks.order_filled_or_partially_filled)
          await this.order_callbacks.order_filled_or_partially_filled(bod)
        if (this.order_callbacks) await this.order_callbacks.order_filled(bod)
      } catch (err) {
        this.logger.error(_data, err)
        Sentry.withScope(function (scope) {
          scope.setTag("operation", "processExecutionReport")
          scope.setTag("pair", symbol)
          if (edge) scope.setTag("edge", edge)
          if (order_id) scope.setTag("order_id", order_id)
          Sentry.captureException(err)
        })
        throw err
      }
    } else {
      throw new Error(`Unknown eventType: ${(_data as any).eventType}`)
    }
  }

  // Event publishers
  async orderPartialExecution() {}
  async orderCompletedExecution() {} // includes cancelled?
  async orderCancelled() {} // includes cancelled?
}
