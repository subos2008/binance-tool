// Converts a stream of exchange order info into a defined interface of callbacks

import { strict as assert } from "assert"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../../interfaces/logger"
import { FtxOrderCallbacks, FtxOrderWsEvent, FtxWsOrderData } from "../../../interfaces/exchange/ftx/orders"
import { FtxWebsocketClient } from "../../../classes/exchanges/ftx/websocket-client"

import * as Sentry from "@sentry/node"

export class FtxOrderExecutionTracker {
  send_message: Function
  logger: Logger
  ws: FtxWebsocketClient
  closeUserWebsocket: Function
  order_callbacks: FtxOrderCallbacks | undefined
  print_all_trades: boolean = true

  // All numbers are expected to be passed in as strings
  constructor({
    ws, // FTX WebSocket
    send_message,
    logger,
    order_callbacks,
    print_all_trades,
  }: {
    ws: FtxWebsocketClient
    send_message: (msg: string) => void
    logger: Logger
    order_callbacks?: FtxOrderCallbacks
    print_all_trades?: boolean
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.order_callbacks = order_callbacks
    assert(ws)
    this.ws = ws
    if (print_all_trades) this.print_all_trades = true

    process.on("exit", () => {
      this.shutdown_streams()
    })
  }

  async main() {
    try {
      await this.monitor_order_stream()
    } catch (error) {
      Sentry.captureException(error)
      this.logger.error(error)
      throw error
    }
  }

  shutdown_streams() {
    this.logger.error(`shutdown_streams not implemented for FtxOrderExecutionTracker`)
  }

  async monitor_order_stream() {
    this.ws.subscribe("orders")
    let hook = this.processExecutionReport.bind(this)
    this.ws.on("update", hook)
  }

  async processExecutionReport(data: FtxWsOrderData) {
    const { id, market, avgFillPrice, price, side, status: orderStatus, type, size } = data

    if(type === 'subscribed') {
      return
    }
    
    console.info(data)

    if(!id) {
      console.error(data)
    }
    let orderId = id.toString()
    let orderType = type.toUpperCase()

    try {
    } catch (error) {
      this.logger.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("operation", "processExecutionReport")
        scope.setTag("market_symbol", market)
        if (orderId) scope.setTag("orderId", orderId)
        Sentry.captureException(error)
      })
    }

    if (this.print_all_trades) {
      this.logger.info(`${market} ${side} ${orderType} ORDER #${orderId} (${orderStatus})`)
      this.logger.info(
        `..price: ${price.toFixed()}, quantity: ${size.toFixed()}, averageExecutionPrice: ${avgFillPrice.toFixed()}`
      )
    }

    if (orderStatus !== "closed") {
      this.logger.warn(`Unknown order status for FtxOrderTracker: ${orderStatus}`)
    }

    // if (this.order_callbacks) await this.order_callbacks.order_filled_or_partially_filled(orderId, data)

    if (orderStatus == "closed") {
      if (this.order_callbacks) await this.order_callbacks.order_filled(orderId, data)
    }
  }
}
