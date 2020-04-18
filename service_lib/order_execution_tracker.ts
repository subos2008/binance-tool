const assert = require("assert");

import { BigNumber } from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

import { OrderState } from "../classes/redis_order_state";

import { Logger } from '../interfaces/logger'

export class OrderExecutionTracker {
  send_message: Function;
  logger: Logger;
  ee: any;
  closeUserWebsocket: Function;
  order_state: OrderState;

  // All numbers are expected to be passed in as strings
  constructor({
    ee, // binance-api-node API
    send_message,
    logger,
    order_state
  }: { ee: any, send_message: (msg: string) => void, logger: Logger, order_state: OrderState }) {
    assert(logger);
    this.logger = logger;
    assert(send_message);
    this.send_message = send_message;
    assert(order_state);
    this.order_state = order_state;

    assert(ee);
    this.ee = ee;

    process.on("exit", () => {
      this.shutdown_streams();
    });
  }


  async main() {
    try {
      await this.monitor_user_stream();
    } catch (error) {
      this.logger.error(error);
      throw (error)
    }
  }

  shutdown_streams() {
    if (this.closeUserWebsocket)
      this.logger.info(`Shutting down streams`);
    if (this.closeUserWebsocket) this.closeUserWebsocket();
  }

  async monitor_user_stream() {
    this.closeUserWebsocket = await this.ee.ws.user(async (data: any) => {
      try {
        const { orderId, eventType } = data;
        if (eventType !== "executionReport") {
          return;
        }
        this.processExecutionReport(data)
      } catch (error) {
        let msg = `SHIT: error tracking orders for pair ${data.symbol}`;
        this.logger.error(msg);
        this.logger.error(error);
        this.send_message(msg);
      }
    });
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
      totalTradeQuantity
    } = data;

    this.logger.info(
      `${symbol} ${side} ${orderType} ORDER #${orderId} (${orderStatus})`
    );
    this.logger.info(`..price: ${price}, quantity: ${quantity}`);

    if (orderStatus === "NEW") {
      // TODO: initialise in redis? could add ${symbol} ${side} ${orderType} and ${orderStatus}
      this.order_state.add_new_order(orderId, { symbol, side, orderType, orderStatus })
      return;
    }

    if (orderStatus === "PARTIALLY_FILLED") {
      // TODO: initialise in redis? could add ${symbol} ${side} ${orderType} and ${orderStatus}
      this.order_state.set_total_executed_quantity(orderId, new BigNumber(totalTradeQuantity), false, orderStatus)
      return;
    }

    if (orderStatus === "CANCELED" /*&& orderRejectReason === "NONE"*/) {
      // Assume user cancelled order and exit
      // `Order was cancelled, presumably by user. Exiting.`,
      this.order_state.set_order_cancelled(orderId, true, orderRejectReason, orderStatus)
      return;
    }

    if (orderStatus !== "FILLED") {
      throw new Error(`Unexpected orderStatus: ${orderStatus}. Reason: ${data.r}`);
    }

    this.order_state.set_total_executed_quantity(orderId, new BigNumber(totalTradeQuantity), true, orderStatus)
  }

  // Event Listeners
  async newOrderId() {
    // we might have orphaned data matching an order, when we get this event
    // we check to see if that has happened and copy the data accross. This mitigates
    // the case where the binance stream sends out a completed order before the orderId
    // is associated with the trade
  }

  // Event publishers
  async orderPartialExecution() { }
  async orderCompletedExecution() { } // includes cancelled?
  async orderCancelled() { } // includes cancelled?
}
