const assert = require("assert");
const utils = require('../lib/utils')

import { TradeDefinition } from "./trade_definition";
import { Logger } from "../interfaces/logger";
import { TradeState } from './redis_trade_state'
import { AlgoUtils } from "../service_lib/algo_utils"
import { TradeExecutor } from "../lib/trade_executor"

import BigNumber from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

export class TradeOrderCreator {
  logger: Logger
  trade_definition: TradeDefinition
  trade_state: TradeState
  algo_utils: AlgoUtils
  buy_price: BigNumber | null
  stop_price: BigNumber | null
  target_price: BigNumber | null
  exchange_info: any
  mummy: TradeExecutor // a crutch while we get started

  constructor(logger: Logger, trade_definition: TradeDefinition, trade_state: TradeState, algo_utils: AlgoUtils, exchange_info: any, mummy: TradeExecutor) {
    this.logger = logger
    this.trade_definition = trade_definition
    this.trade_state = trade_state
    this.algo_utils = algo_utils
    this.target_price = this.trade_definition.munged.target_price
    this.stop_price = this.trade_definition.munged.stop_price
    this.buy_price = this.trade_definition.munged.buy_price
    this.exchange_info = exchange_info
    this.mummy = mummy

    this.logger.warn(`WARNING: STOP_LOSS_LIMIT orders need work`);
  }

  async placeStopOrder() {
    this.logger.warn(
      `Need to add code to create a market sell if STOP_LOSS_LIMIT order is rejected by exchange.`
    );
    let orderId = await this._create_stop_loss_limit_sell_order();
    this.logger.info(`order id: ${orderId}`);
    return orderId;
  }

  async placeTargetOrder() {
    return await this._create_limit_sell_order({
      price: this.target_price,
      base_amount: await this.trade_state.get_base_amount_held()
    });
  }

  async placeSellOrder() {
    if (
      (await this.trade_state.get_stopOrderId()) ||
      (await this.trade_state.get_targetOrderId())
    ) {
      console.log(
        `placeSellOrder: orders already exist, skipping. (stop: ${await this.trade_state.get_stopOrderId()}, target: ${await this.trade_state.get_targetOrderId()})`
      );
      return;
    }

    if (this.stop_price) {
      // Fuck so here (on restart) we would have:
      // only if there isn't already a stop order
      // if there is a stop order is it completed in which case clean up redis... 
      // or move that "maintain redis" logic to a separate microservice and have the main
      // trade process just match the current orders to the redis state
      //.. i guess in general what the above comment means is don't create the sell orders if
      // they exist already. .. and what if they existed and already completed? Well presumably that
      // would get caught by checks further up .. we could assert that there is some position available left to
      // sell - so basically we set the amount to sell here based on how much remains to be sold - and if that
      // is an untradable amount we set trade completed and exit (somehow, somewhere)
      await this.trade_state.set_stopOrderId(await this.placeStopOrder());
    } else if (this.target_price) {
      await this.trade_state.set_targetOrderId(await this.placeTargetOrder());
    } else {
      this.mummy.execution_complete("buy completed and no sell actions defined");
    }
  }

  async _create_limit_buy_order() {
    try {
      assert(!(await this.trade_state.get_buyOrderId()));
      assert(this.trade_definition.munged.buy_price && !this.trade_definition.munged.buy_price.isZero());
      let price = this.trade_definition.munged.buy_price;
      let { base_amount } = await this.mummy.size_position();
      base_amount = this._munge_amount_and_check_notionals({
        base_amount,
        price
      });
      console.log(`base_amount: ${base_amount.toFixed()}`);
      let response = await this.algo_utils.create_limit_buy_order({
        pair: this.trade_definition.pair,
        base_amount,
        price
      });
      return response.orderId;
    } catch (error) {
      async_error_handler(this.logger, `Buy error: ${error.body}`, error);
    }
  }

  async _create_limit_sell_order({ price, base_amount }: { price: BigNumber, base_amount: BigNumber }) {
    assert(price);
    assert(base_amount);
    try {
      base_amount = await this.trade_state.get_base_amount_held();
      base_amount = this._munge_amount_and_check_notionals({
        base_amount,
        price
      });
      let response = await this.algo_utils.create_limit_sell_order({
        pair: this.trade_definition.pair,
        base_amount,
        price
      });
      return response.orderId;
    } catch (error) {
      async_error_handler(this.logger, `Sell error: ${error.body}`, error);
    }
  }

  async _create_stop_loss_limit_sell_order(
    { limit_price_factor } = { limit_price_factor: new BigNumber("0.8") }
  ) {
    try {
      assert(limit_price_factor);
      assert(this.stop_price !== null);
      if (this.stop_price === null) {
        throw new Error(`_create_stop_loss_limit_sell_order called when stop_price is null`)
      }
      let base_amount = await this.trade_state.get_base_amount_held();
      assert(base_amount);
      assert(!base_amount.isZero());
      base_amount = this._munge_amount_and_check_notionals({
        base_amount,
        stop_price: this.stop_price
      });

      // Originally user could specify a limit price, now we calculate it instead
      this.logger.warn(
        `STOP_LIMIT_SELL order using default limit_price_factor of ${limit_price_factor}`
      );
      let price = this.stop_price.times(limit_price_factor);
      price = utils.munge_and_check_price({
        exchange_info: this.exchange_info,
        symbol: this.trade_definition.pair,
        price
      });
      let response = await this.algo_utils.create_stop_loss_limit_sell_order({
        pair: this.trade_definition.pair,
        base_amount,
        price,
        stop_price: this.stop_price
      });
      return response.orderId;
    } catch (error) {
      async_error_handler(this.logger, `Sell error: ${error.body}`, error);
    }
  }

  async _create_market_buy_order() {
    try {
      assert(!(await this.trade_state.get_buyOrderId()));
      let { base_amount } = await this.mummy.size_position();
      base_amount = this._munge_amount_and_check_notionals({
        base_amount,
        buy_price: this.trade_definition.munged.buy_price
      });
      let response = await this.algo_utils.create_market_buy_order({
        base_amount,
        pair: this.trade_definition.pair
      });
      return response.orderId;
    } catch (error) {
      async_error_handler(this.logger, `Buy error: ${error.body}`, error);
    }
  }

  _munge_amount_and_check_notionals({ base_amount }: { base_amount: BigNumber }) {
    let { buy_price, stop_price, target_price, limit_price } = this;
    assert(base_amount);
    const original_base_amount = new BigNumber(base_amount);
    console.log(`orig base_amount: ${original_base_amount}`);
    const new_base_amount = this.algo_utils.munge_amount_and_check_notionals({
      pair:this.trade_definition.pair,
      base_amount,
      buy_price,
      stop_price,
      target_price,
      limit_price
    });
    console.log(`new base_amount: ${new_base_amount}`);

    if (!new_base_amount.eq(original_base_amount)) {
      console.log(
        `Base amount changed during munging from ${original_base_amount.toFixed()} to ${new_base_amount.toFixed()}.`
      );
    }
    return new_base_amount;
  }
}
