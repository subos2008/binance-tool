import { strict as assert } from 'assert';
const { promisify } = require("util");

var stringToBool = (myValue: string) => myValue === "true";

import { Logger } from '../../interfaces/logger'
import { BigNumber } from 'bignumber.js';
import { RedisClient } from 'redis';
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

import * as Sentry from '@sentry/node';
export class RedisPositionsState {
  logger: Logger;
  redis: any;
  set_redis_key: any;
  get_redis_key: any;
  delAsync: any;
  msetnxAsync: any;
  msetAsync: any;
  mgetAsync: any;
  incrbyAsync: any;

  constructor({ logger, redis }: { logger: Logger, redis: RedisClient }) {
    assert(logger);
    this.logger = logger;
    assert(redis);
    this.redis = redis;

    this.set_redis_key = promisify(this.redis.set).bind(this.redis);
    this.get_redis_key = promisify(this.redis.get).bind(this.redis);
    this.delAsync = promisify(this.redis.del).bind(this.redis);
    this.msetnxAsync = promisify(this.redis.msetnx).bind(this.redis);
    this.msetAsync = promisify(this.redis.mset).bind(this.redis);
    this.mgetAsync = promisify(this.redis.mget).bind(this.redis);
    this.incrbyAsync = promisify(this.redis.incrby).bind(this.redis);
  }

  name_to_key({ symbol, name, exchange, account }: { symbol: string, name: string, exchange: string, account: string }) {
    switch (name) {
      case "position_size":
        return `positions:${exchange}:${account}:${symbol}:position_size`;
      case "initial_entry_price":
        return `positions:${exchange}:${account}:${symbol}:initial_entry_price`;
      case "netQuoteBalanceChange":
        return `positions:${exchange}:${account}:${symbol}:netQuoteBalanceChange`;
      default:
        throw new Error(`Unknown key name: ${name}`);
    }
  }

  async set_position_size({ symbol, position_size, exchange, account }: { symbol: string, position_size: BigNumber, exchange: string, account: string }): Promise<void> {
    try {
      await this.msetAsync(
        this.name_to_key({ symbol, exchange, account, name: "position_size" }), position_size.toFixed()
      )
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("symbol", symbol);
        scope.setTag("exchange", exchange);
        scope.setTag("account", account);
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error);
      });
      throw error
    }
  }

  async get_position_size({ symbol, exchange, account }: { symbol: string, exchange: string, account: string }): Promise<BigNumber> {
    const key = this.name_to_key({ symbol, exchange, account, name: "position_size" });
    return new BigNumber((await this.get_redis_key(key)) || 0);
  }

  async create_new_position(
    { symbol, exchange, account }: { symbol: string, exchange: string, account: string },
    { position_size, initial_entry_price, quote_invested }: { position_size: BigNumber, initial_entry_price?: BigNumber, quote_invested: BigNumber }) {
    try {
      await this.msetAsync(
        this.name_to_key({ symbol, exchange, account, name: "position_size" }), position_size.toFixed(),
      )
      if (initial_entry_price) await this.msetAsync(
        this.name_to_key({ symbol, exchange, account, name: "initial_entry_price" }), initial_entry_price?.toFixed(),
      )
      if (quote_invested) await this.msetAsync(
        this.name_to_key({ symbol, exchange, account, name: "netQuoteBalanceChange" }), quote_invested?.toFixed()
      )
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("symbol", symbol);
        scope.setTag("exchange", exchange);
        scope.setTag("account", account);
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error);
      });
      throw error
    }
  }

  async increase_position_size_by(
    { symbol, exchange, account }: { symbol: string, exchange: string, account: string },
    amount: BigNumber) {
      try {
        await this.incrbyAsync(
          this.name_to_key({ symbol, exchange, account, name: "position_size" }), amount.toFixed(),
        )
      } catch (error) {
        console.error(error)
        Sentry.withScope(function (scope) {
          scope.setTag("symbol", symbol);
          scope.setTag("exchange", exchange);
          scope.setTag("account", account);
          // scope.setTag("redis.connected", this.redis.connected.toString());
          Sentry.captureException(error);
        });
        throw error
      }
  }

  // async set_order_completed(order_id: string, value: Boolean, orderStatus: string): Promise<void> {
  //   assert(value === true);
  //   await this.msetAsync(
  //     this.name_to_key(order_id, "orderStatus"), orderStatus,
  //     this.name_to_key(order_id, "completed"), value,
  //   )
  // }

  // async set_order_cancelled(order_id: string, value: Boolean, orderRejectReason: string | undefined, orderStatus: string | undefined): Promise<void> {
  //   assert(value === true);
  //   await this.msetAsync(
  //     this.name_to_key(order_id, "completed"), true,
  //     this.name_to_key(order_id, "cancelled"), true,
  //     this.name_to_key(order_id, "orderStatus"), orderStatus,
  //     this.name_to_key(order_id, "orderRejectReason"), orderRejectReason,
  //   )
  // }

  // async get_order_completed(order_id: string): Promise<Boolean> {
  //   const key = this.name_to_key(order_id, "completed");
  //   return stringToBool(await this.get_redis_key(key));
  // }

  // async add_new_order(order_id: string, { symbol, side, orderType, orderStatus, base_amount }: { symbol: string, side: string, orderType: string, orderStatus?: string, base_amount?: BigNumber }): Promise<void> {
  //   // so... we only add these values if they don't already exist, probably ought to
  //   // add them atomically.. aren't all redis operations atomic? But does this do
  //   // "all or none" behaviour?
  //   try {
  //     await this.msetnxAsync(
  //       this.name_to_key(order_id, "symbol"), symbol,
  //       this.name_to_key(order_id, "side"), side,
  //       this.name_to_key(order_id, "orderType"), orderType,
  //       this.name_to_key(order_id, "orderStatus"), orderStatus || 'NEW',
  //       this.name_to_key(order_id, "completed"), false,
  //       this.name_to_key(order_id, "total_executed_quantity"), "0"
  //     )
  //     if (base_amount) {
  //       await this.msetnxAsync(
  //         this.name_to_key(order_id, "base_amount"), base_amount.toFixed(),
  //       )
  //     }
  //   } catch (error) {
  //     Sentry.withScope(function (scope) {
  //       scope.setTag("symbol", symbol);
  //       scope.setTag("side", side);
  //       scope.setTag("orderType", orderType);
  //       if (base_amount) scope.setTag("base_amount", base_amount.toFixed());
  //       //scope.setTag("redis.connected", this.redis.connected.toString());
  //       Sentry.captureException(error);
  //     });
  //     throw error
  //   }
  // }

  // async get_state_as_object(order_id: string) {
  //   const values = await this.mgetAsync(
  //     this.name_to_key(order_id, "symbol"),
  //     this.name_to_key(order_id, "side"),
  //     this.name_to_key(order_id, "orderType"),
  //     this.name_to_key(order_id, "orderStatus"),
  //     this.name_to_key(order_id, "completed"),
  //     this.name_to_key(order_id, "total_executed_quantity"),
  //     this.name_to_key(order_id, "cancelled"),
  //     this.name_to_key(order_id, "orderRejectReason"),
  //   )
  //   return Object.assign(
  //     {
  //       orderId: order_id,
  //       symbol: values[0],
  //       side: values[1],
  //       orderType: values[2],
  //       orderStatus: values[3],
  //       completed: values[4],
  //       total_executed_quantity: values[5],
  //       cancelled: values[6],
  //       orderRejectReason: values[7]
  //     },
  //   )
  // }

  // async print(order_id: string) {
  //   const object = await this.get_state_as_object(order_id)
  //   this.logger.info(
  //     `${object.symbol} ${object.side} ${object.orderType} ORDER #${object.orderId} (${object.orderStatus})`
  //   );
  //   console.dir(object);
  // }
}
