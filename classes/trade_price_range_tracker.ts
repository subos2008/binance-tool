const assert = require("assert");
import { Logger } from "../interfaces/logger";

import BigNumber from "bignumber.js";
import { TradeState } from "./persistent_state/redis_trade_state";
import { TradeDefinition } from "./specifications/trade_definition";
import { PriceRanges } from "./specifications/price_ranges";
import { TradeOrderCreator } from '../classes/trade_order_creator'


BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

export class TradePriceRangeTracker {
  logger: Logger
  send_message: (msg: string) => void
  closeTradesWebSocket: () => void | null
  trade_state: TradeState
  trade_definition: TradeDefinition
  price_ranges: PriceRanges
  trade_order_creator: TradeOrderCreator

  constructor(logger: Logger, send_message: (msg: string) => void, trade_definition: TradeDefinition, trade_state: TradeState,
    price_ranges: PriceRanges, trade_order_creator: TradeOrderCreator) {

    this.logger = logger
    this.trade_definition = trade_definition
    this.trade_state = trade_state
    this.price_ranges = price_ranges
    this.send_message = send_message
    this.trade_order_creator = trade_order_creator

    if (this.trade_definition.soft_entry) {
      if (this.trade_definition.unmunged.buy_price === null) {
        throw new Error(`soft_entry set when buy_price is null`)
      }
      this.logger.info(
        `Soft entry buy order trigger price: ${this.price_ranges.soft_entry_buy_order_trigger_price.toFixed()}`
      );
    }
  }

  shutdown_streams() {
    if (this.closeTradesWebSocket) {
      this.logger.info(`Shutting down streams`);
      this.closeTradesWebSocket();
    }
  }

  async main() {
    let waiting_for_soft_entry_price = false;
    if (this.trade_definition.soft_entry) {
      this.logger.info(
        `Soft entry mode: waiting for entry price before placing order`
      );
      waiting_for_soft_entry_price = true;
    }
    let isCancelling = false;
    let report_when_target_price_hit = true;
    let report_when_stop_price_hit = true;
    this.closeTradesWebSocket = await this.ee.ws.aggTrades(
      [this.trade_definition.pair],
      async (trade: { symbol: string, price: string }) => {
        var { symbol, price: string_price } = trade;
        assert(symbol);
        assert(string_price);
        const price = new BigNumber(string_price);
        if (waiting_for_soft_entry_price) {
          if (
            price.isLessThanOrEqualTo(
              this.price_ranges.soft_entry_buy_order_trigger_price
            )
          ) {
            waiting_for_soft_entry_price = false;
            this.send_message(
              `${symbol} soft entry buy order trigger price hit`
            );
            await this.trade_state.set_buyOrderId(
              await this.trade_order_creator._create_limit_buy_order()
            );
          }
        } else if (await this.trade_state.get_buyOrderId()) {
          // this.logger.info(`${symbol} trade update. price: ${price} buy: ${this.buy_price}`);
        } else if (
          (await this.trade_state.get_stopOrderId()) ||
          (await this.trade_state.get_targetOrderId())
        ) {
          // this.logger.info(
          // 	`${symbol} trade update. price: ${price} stop: ${this.stop_price} target: ${this.target_price}`
          // );
          if (
            typeof this.target_price !== "undefined" &&
            price.isGreaterThanOrEqualTo(this.target_price) &&
            report_when_target_price_hit
          ) {
            report_when_target_price_hit = false;
            let msg = `${symbol} target price hit`;
            this.logger.info(msg);
            this.send_message(msg);
          }
          if (
            typeof this.stop_price !== "undefined" &&
            price.isLessThanOrEqualTo(this.stop_price) &&
            report_when_stop_price_hit
          ) {
            report_when_stop_price_hit = false;
            let msg = `${symbol} stop price hit`;
            this.logger.info(msg);
            this.send_message(msg);
          }
          if (
            typeof this.target_price !== "undefined" &&
            (await this.trade_state.get_stopOrderId()) &&
            !(await this.trade_state.get_targetOrderId()) &&
            price.isGreaterThanOrEqualTo(this.target_price) &&
            !isCancelling
          ) {
            {
              let msg = `Event: price >= target_price: cancelling stop and placeTargetOrder()`;
              this.logger.info(msg);
              this.send_message(msg);
            }
            isCancelling = true;
            try {
              let stopOrderId = await this.trade_state.get_stopOrderId();
              await this.trade_state.set_stopOrderId(undefined); // Do before await cancelOrder
              await this.ee.cancelOrder({ symbol, orderId: stopOrderId });
              isCancelling = false;
            } catch (error) {
              this.logger.error(`${symbol} cancel error: ${error.body}`);
              this.logger.error(error);
              return;
            }
            try {
              await this.trade_state.set_targetOrderId(
                await this.trade_order_creator.placeTargetOrder()
              );
            } catch (error) {
              // async_error_handler(
              //   this.logger,
              //   `error placing order: ${error.body}`,
              //   error
              // );
              throw error
            }
          } else if (
            (await this.trade_state.get_targetOrderId()) &&
            !(await this.trade_state.get_stopOrderId()) &&
            price.isLessThanOrEqualTo(this.stop_price) &&
            !isCancelling
          ) {
            isCancelling = true;
            try {
              let targetOrderId = await this.trade_state.get_targetOrderId();
              await this.trade_state.set_targetOrderId(undefined); // Do before await cancelOrder
              await this.ee.cancelOrder({ symbol, orderId: targetOrderId });
              isCancelling = false;
            } catch (error) {
              this.logger.error(`${symbol} cancel error ${error.body}`);
              return;
            }
            this.logger.info(`${symbol} cancel response: ${response}`);
            try {
              await this.trade_state.set_stopOrderId(
                await this.trade_order_creator.placeStopOrder()
              );
            } catch (error) {
              // async_error_handler(
              //   this.logger,
              //   `error placing order: ${error.body}`,
              //   error
              // );
              throw error
            }
          }
        }
      }
    );
  }
}
