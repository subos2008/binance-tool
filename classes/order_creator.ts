import { strict as assert, throws } from 'assert';
const utils = require('../lib/utils')
var util = require('util');

// Uses Custm OrderIds and maintains associations in redis
// Improvements:
//  * Create a RedisOrderState class instead of managing `order_associations:` from TradeState
//  * We need to evolve error handling here: i.e. balance is too low, MIN_NOTIONAL etc
//  * this is already getting Binance specific as the redis_order_state matches the Binance
//    order fields
//  * We leave state in redis for aborted (error on creation) orders, we should clean that up

import { Logger } from "../interfaces/logger";
import { TradeState } from './persistent_state/redis_trade_state'
import { OrderState } from './persistent_state/redis_order_state'
import { AlgoUtils } from "../service_lib/algo_utils"

import BigNumber from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

import * as Sentry from '@sentry/node';
import { RedisClient } from 'redis';

export class OrderCreator {
  logger: Logger
  redis: RedisClient
  trade_state: TradeState
  algo_utils: AlgoUtils
  exchange_info: any

  constructor(logger: Logger, redis: RedisClient, algo_utils: AlgoUtils) {
    this.logger = logger
    this.redis = redis
    this.algo_utils = algo_utils
  }

  // async _create_limit_buy_order() {
  //   try {
  //     assert(!(await this.trade_state.get_buyOrderId()));
  //     assert(this.trade_definition.munged.buy_price && !this.trade_definition.munged.buy_price.isZero());
  //     let price = this.trade_definition.munged.buy_price;
  //     if (!price) throw new Error(`_create_limit_buy_order called when trade_definition.munged.buy_price is null`)
  //     let { base_amount } = await this.mummy.size_position();
  //     base_amount = this._munge_amount_and_check_notionals({
  //       base_amount,
  //       price
  //     });
  //     this.trade_state.set_target_base_amount_to_buy(base_amount)
  //     this.logger.info(`base_amount: ${base_amount.toFixed()}`);
  //     let response = await this.algo_utils.create_limit_buy_order({
  //       pair: this.trade_definition.pair,
  //       base_amount,
  //       price
  //     });
  //     return response.orderId;
  //   } catch (error) {
  //     Sentry.captureException(error);
  //     // async_error_handler(this.logger, `Buy error: ${error.body}`, error);
  //     throw error
  //   }
  // }

  // async _create_limit_sell_order({ price, base_amount }: { price: BigNumber, base_amount: BigNumber }) {
  //   assert(price);
  //   assert(base_amount);
  //   try {
  //     base_amount = this._munge_amount_and_check_notionals({
  //       base_amount,
  //       price
  //     });
  //     let response = await this.algo_utils.create_limit_sell_order({
  //       pair: this.trade_definition.pair,
  //       base_amount,
  //       price
  //     });
  //     return response.orderId;
  //   } catch (error) {
  //     Sentry.captureException(error);
  //     this.logger.error(`Sell error: ${error.body}`);
  //     throw error
  //   }
  // }

  // async _create_stop_loss_limit_sell_order(
  //   { limit_price_factor } = { limit_price_factor: new BigNumber("0.8") }
  // ) {
  //   if (!this.trade_definition.munged.stop_price) throw new Error(`_create_stop_loss_limit_sell_order called when this.trade_definition.munged.stop_price is not defined`)
  //   try {
  //     assert(limit_price_factor);
  //     assert(this.trade_definition.munged.stop_price !== null);
  //     if (this.trade_definition.munged.stop_price === null) {
  //       throw new Error(`_create_stop_loss_limit_sell_order called when stop_price is null`)
  //     }
  //     let base_amount = await this.trade_state.get_base_amount_held();
  //     assert(base_amount);
  //     assert(!base_amount.isZero());
  //     base_amount = this._munge_amount_and_check_notionals({
  //       base_amount,
  //       stop_price: this.trade_definition.munged.stop_price
  //     });

  //     // Originally user could specify a limit price, now we calculate it instead
  //     this.logger.warn(
  //       `STOP_LIMIT_SELL order using default limit_price_factor of ${limit_price_factor}`
  //     );
  //     let price = this.trade_definition.munged.stop_price.times(limit_price_factor);
  //     price = utils.munge_and_check_price({
  //       exchange_info: this.exchange_info,
  //       symbol: this.trade_definition.pair,
  //       price
  //     });
  //     let response = await this.algo_utils.create_stop_loss_limit_sell_order({
  //       pair: this.trade_definition.pair,
  //       base_amount,
  //       price,
  //       stop_price: this.trade_definition.munged.stop_price
  //     });
  //     return response.orderId;
  //   } catch (error) {
  //     Sentry.captureException(error);
  //     // async_error_handler(this.logger, `Sell error: ${error.body}`, error);
  //     throw error
  //   }
  // }

  // async _create_market_buy_order() {
  //   try {
  //     assert(!(await this.trade_state.get_buyOrderId()));
  //     let { base_amount } = await this.mummy.size_position();
  //     base_amount = this._munge_amount_and_check_notionals({
  //       base_amount,
  //       buy_price: this.trade_definition.munged.buy_price
  //     });
  //     let response = await this.algo_utils.create_market_buy_order({
  //       base_amount,
  //       pair: this.trade_definition.pair
  //     });
  //     return response.orderId;
  //   } catch (error) {
  //     Sentry.captureException(error);
  //     // async_error_handler(this.logger, `Buy error: ${error.body}`, error);
  //     throw error
  //   }
  // }

  // TODO: race condition-ish, needs an incr somewhere or we could make quick fire orders with the same ID
  async create_new_order_id(pair: string) {
    // OV1 => Order ID Version
    // -B- => Binance
    let id = `OV1-B-${Date.now()}-${pair}-incr_me`
    assert(id.match(/^[a-zA-Z0-9-_]{1,36}$/), `Generated custom orderId is invalid: ${id}`)
    this.logger.warn(`WARNNG: create_new_order_id only unique by timestamp and pair: ${id}`)
    return id
  }

  // We need to evolve error handling in OrderCreator.market_sell: i.e. balance is too low, MIN_NOTIONAL etc
  async market_sell({ trade_state, pair, base_amount }: { trade_state?: TradeState, pair: string, base_amount: BigNumber }) {
    this.logger.warn(`We need to evolve error handling in OrderCreator.market_sell: i.e. balance is too low, MIN_NOTIONAL etc`)
    var orderId: string | undefined;
    try {
      orderId = await this.create_new_order_id(pair)
      base_amount = this._munge_amount_and_check_notionals({ base_amount, pair });

      // Add (to) persistant state 
      const order_state = new OrderState({ logger: this.logger, redis: this.redis })

      if (trade_state) {
        const trade_definition = await trade_state.get_trade_definition()
        assert(pair === trade_definition.pair)
        await trade_state.associate_order_with_trade(orderId)
      }
      await order_state.add_new_order(orderId, { symbol: pair, side: 'SELL', orderType: 'MARKET', base_amount })

      // Submit to exchange, OrderExecutionTracker will take it from here
      let response = await this.algo_utils.create_market_sell_order({
        base_amount,
        pair,
        orderId
      });
      return response.orderId;
    } catch (error) {
      Sentry.withScope(function (scope) {
        scope.setTag("operation", "market_sell");
        scope.setTag("pair", pair);
        if (orderId) scope.setTag("orderId", orderId);
        Sentry.captureException(error);
      });
      throw error
    }
  }

  async market_buy({ trade_state, pair, base_amount }: { trade_state?: TradeState, pair: string, base_amount: BigNumber }) {
    this.logger.warn(`We need to evolve error handling in OrderCreator.market_buy: i.e. balance is too low, MIN_NOTIONAL etc`)
    var orderId: string | undefined;
    try {
      orderId = await this.create_new_order_id(pair)
      base_amount = this._munge_amount_and_check_notionals({ base_amount, pair });

      // Add (to) persistant state 
      const order_state = new OrderState({ logger: this.logger, redis: this.redis })

      if (trade_state) {
        const trade_definition = await trade_state.get_trade_definition()
        assert(pair === trade_definition.pair)
        await trade_state.associate_order_with_trade(orderId)
      }
      await order_state.add_new_order(orderId, { symbol: pair, side: 'BUY', orderType: 'MARKET', base_amount })

      // Submit to exchange, OrderExecutionTracker will take it from here
      let response = await this.algo_utils.create_market_buy_order({
        base_amount,
        pair,
        orderId
      });
      return response.orderId;
    } catch (error) {
      Sentry.withScope(function (scope) {
        scope.setTag("operation", "market_buy");
        scope.setTag("pair", pair);
        if (orderId) scope.setTag("orderId", orderId);
        Sentry.captureException(error);
      });
      throw error
    }
  }

  _munge_amount_and_check_notionals({ base_amount, buy_price, stop_price, target_price, price, pair }:
    { base_amount: BigNumber, buy_price?: BigNumber, stop_price?: BigNumber, target_price?: BigNumber, price?: BigNumber, pair: string }) {
    assert(base_amount);
    const original_base_amount = new BigNumber(base_amount);
    this.logger.info(`orig base_amount: ${original_base_amount.toFixed()}`);
    const new_base_amount = this.algo_utils.munge_amount_and_check_notionals({
      pair,
      base_amount,
      buy_price,
      stop_price,
      target_price,
      price
    });
    this.logger.info(`new base_amount: ${new_base_amount.toFixed()}`);

    if (!new_base_amount.eq(original_base_amount)) {
      this.logger.info(
        `Base amount changed during munging from ${original_base_amount.toFixed()} to ${new_base_amount.toFixed()}.`
      );
    }
    return new_base_amount;
  }
}
