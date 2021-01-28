import { strict as assert } from 'assert';
import { Logger } from "../interfaces/logger";

import BigNumber from "bignumber.js";
import { TradeState } from "./persistent_state/redis_trade_state";
import { TradeDefinition } from "./specifications/trade_definition";
import { PriceRanges } from "./specifications/price_ranges";
import { TradeOrderCreator } from '../classes/trade_order_creator'

import * as Sentry from '@sentry/node';

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

export class TradePriceRangeTracker {
  logger: Logger
  send_message: (msg: string) => void
  closeTradesWebSocket: (() => void) | null
  trade_state: TradeState
  trade_definition: TradeDefinition
  price_ranges: PriceRanges
  trade_order_creator: TradeOrderCreator
  ee: any

  constructor(logger: Logger, send_message: (msg: string) => void, trade_definition: TradeDefinition, trade_state: TradeState,
    price_ranges: PriceRanges, trade_order_creator: TradeOrderCreator, ee: any) {

    this.logger = logger
    this.trade_definition = trade_definition
    this.trade_state = trade_state
    this.price_ranges = price_ranges
    this.send_message = send_message
    this.trade_order_creator = trade_order_creator
    this.ee = ee

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
      this.closeTradesWebSocket = null
    }
  }

  async main() {
    let waiting_for_soft_entry_price = false;
    this.logger.info(`soft_entry: ${this.trade_definition.soft_entry}, buying_allowed: ${await this.trade_state.get_buying_allowed()}, buyOrderId: ${await this.trade_state.get_buyOrderId()}`)
    if (this.trade_definition.soft_entry && await this.trade_state.get_buying_allowed() && !await this.trade_state.get_buyOrderId()) {
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
        try {
          var { symbol, price: string_price } = trade;
          assert(symbol);
          assert(string_price);
          // this.logger.info(`${symbol}: ${string_price}`)
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
              await this.trade_order_creator.placeBuyOrder()
              let tmp = await this.trade_state.get_buyOrderId()
              this.send_message(`Returned from placeBuyOrder, id is ${tmp}`);
            }
          } else if (await this.trade_state.get_buyOrderId()) {
            // this.logger.info(`${symbol} trade update. price: ${price} buy: ${this.buy_price}`);
          } else if (
            (await this.trade_state.get_stopOrderId()) ||
            (await this.trade_state.get_targetOrderId())
          ) {
            // this.logger.info(
            // 	`${symbol} trade update. price: ${price} stop: ${this.stop_price} target: ${this.tartrade_definition.munged.get_price}`
            // );
            if (
              typeof this.trade_definition.munged.target_price !== "undefined" &&
              price.isGreaterThanOrEqualTo(this.trade_definition.munged.target_price) &&
              report_when_target_price_hit
            ) {
              report_when_target_price_hit = false;
              let msg = `${symbol} target price hit`;
              this.logger.info(msg);
              this.send_message(msg);
            }
            if (
              typeof this.trade_definition.munged.stop_price !== "undefined" &&
              price.isLessThanOrEqualTo(this.trade_definition.munged.stop_price) &&
              report_when_stop_price_hit
            ) {
              report_when_stop_price_hit = false;
              let msg = `${symbol} stop price hit`;
              this.logger.info(msg);
              this.send_message(msg);
            }
            if (
              typeof this.trade_definition.munged.target_price !== "undefined" &&
              (await this.trade_state.get_stopOrderId()) &&
              !(await this.trade_state.get_targetOrderId()) &&
              price.isGreaterThanOrEqualTo(this.trade_definition.munged.target_price) &&
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
                if (stopOrderId) await this.trade_order_creator.cancelOrder({ symbol, orderId: stopOrderId });
                isCancelling = false;
              } catch (error) {
                Sentry.captureException(error);
                this.logger.error(`${symbol} cancel error: ${error.body}`);
                this.logger.error(error);
                return;
              }
              try {
                await this.trade_state.set_targetOrderId(
                  await this.trade_order_creator.placeTargetOrder()
                );
              } catch (error) {
                Sentry.captureException(error);
                throw error
              }
            } else if (
              (await this.trade_state.get_targetOrderId()) &&
              !(await this.trade_state.get_stopOrderId()) &&
              // TODO: remove || 0 hack
              price.isLessThanOrEqualTo(this.trade_definition.munged.stop_price || 0) &&
              !isCancelling
            ) {
              isCancelling = true;
              try {
                let targetOrderId = await this.trade_state.get_targetOrderId();
                await this.trade_state.set_targetOrderId(undefined); // Do before await cancelOrder
                if (targetOrderId) await this.trade_order_creator.cancelOrder({ symbol, orderId: targetOrderId });
                isCancelling = false;
              } catch (error) {
                Sentry.captureException(error);
                this.logger.error(`${symbol} cancel error ${error.body}`);
                return;
              }
              try {
                await this.trade_state.set_stopOrderId(
                  await this.trade_order_creator.placeStopOrder()
                );
              } catch (error) {
                Sentry.captureException(error);
                throw error
              }
            }
          }
        } catch (error) {
          Sentry.captureException(error);
          this.logger.error(`Top level error encountered in TradePriceRangeTracker`);
          this.logger.error(`Top level error: ${error}`);
        }
      }
    );
  }
}
