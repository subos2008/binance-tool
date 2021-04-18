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
export class OrderState {
  logger: Logger;
  redis: any;
  set_redis_key: any;
  get_redis_key: any;
  delAsync: any;
  msetnxAsync: any;
  msetAsync: any;
  mgetAsync: any;

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
  }

  name_to_key(order_id: string, name: string) {
    assert(order_id && order_id !== "")
    switch (name) {
      case "symbol":
        return `orders:${order_id}:symbol`;
      case "side":
        return `orders:${order_id}:side`;
      case "orderType":
        return `orders:${order_id}:orderType`;
      case "orderStatus":
        return `orders:${order_id}:orderStatus`;
      case "completed":
        return `orders:${order_id}:completed`;
      case "total_executed_quantity":
        return `orders:${order_id}:total_executed_quantity`;
      case "cancelled":
        return `orders:${order_id}:cancelled`;
      case "orderRejectReason":
        return `orders:${order_id}:orderRejectReason`;
      case "base_amount":
        // The order quantity
        return `orders:${order_id}:base_amount`;
      default:
        throw new Error(`Unknown key name: ${name}`);
    }
  }

  async set_total_executed_quantity(order_id: string, value: BigNumber, completed: Boolean, orderStatus: string): Promise<void> {
    // TODO: only allow incrementing total_executed_quantity and false->true transitions on completed
    // Probably not needed while we are directly watching the binance stream though
    try {
      await this.msetAsync(
        this.name_to_key(order_id, "orderStatus"), orderStatus,
        this.name_to_key(order_id, "completed"), completed,
        this.name_to_key(order_id, "total_executed_quantity"), value.toFixed()
      )
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("orderStatus", orderStatus);
        scope.setTag("completed", completed.toString());
        scope.setTag("total_executed_quantity", value.toFixed());
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error);
      });
      throw error
    }
  }

  async get_total_executed_quantity(order_id: string): Promise<BigNumber> {
    const key = this.name_to_key(order_id, "total_executed_quantity");
    return new BigNumber((await this.get_redis_key(key)) || 0);
  }

  async set_order_completed(order_id: string, value: Boolean, orderStatus: string): Promise<void> {
    assert(value === true);
    await this.msetAsync(
      this.name_to_key(order_id, "orderStatus"), orderStatus,
      this.name_to_key(order_id, "completed"), value,
    )
  }

  async set_order_cancelled(order_id: string, value: Boolean, orderRejectReason: string | undefined, orderStatus: string | undefined): Promise<void> {
    assert(value === true);
    await this.msetAsync(
      this.name_to_key(order_id, "completed"), true,
      this.name_to_key(order_id, "cancelled"), true,
      this.name_to_key(order_id, "orderStatus"), orderStatus,
      this.name_to_key(order_id, "orderRejectReason"), orderRejectReason,
    )
  }

  async get_order_completed(order_id: string): Promise<Boolean> {
    const key = this.name_to_key(order_id, "completed");
    return stringToBool(await this.get_redis_key(key));
  }

  async add_new_order(order_id: string, { symbol, side, orderType, orderStatus, base_amount }: { symbol: string, side: string, orderType: string, orderStatus?: string, base_amount?: BigNumber }): Promise<void> {
    // so... we only add these values if they don't already exist, probably ought to
    // add them atomically.. aren't all redis operations atomic? But does this do
    // "all or none" behaviour?
    try {
      await this.msetnxAsync(
        this.name_to_key(order_id, "symbol"), symbol,
        this.name_to_key(order_id, "side"), side,
        this.name_to_key(order_id, "orderType"), orderType,
        this.name_to_key(order_id, "orderStatus"), orderStatus || 'NEW',
        this.name_to_key(order_id, "completed"), false,
        this.name_to_key(order_id, "total_executed_quantity"), "0"
      )
      if (base_amount) {
        await this.msetnxAsync(
          this.name_to_key(order_id, "base_amount"), base_amount.toFixed(),
        )
      }
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("symbol", symbol);
        scope.setTag("side", side);
        scope.setTag("orderType", orderType);
        if (base_amount) scope.setTag("base_amount", base_amount.toFixed());
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error);
      });
      throw error
    }
  }

  async get_state_as_object(order_id: string) {
    const values = await this.mgetAsync(
      this.name_to_key(order_id, "symbol"),
      this.name_to_key(order_id, "side"),
      this.name_to_key(order_id, "orderType"),
      this.name_to_key(order_id, "orderStatus"),
      this.name_to_key(order_id, "completed"),
      this.name_to_key(order_id, "total_executed_quantity"),
      this.name_to_key(order_id, "cancelled"),
      this.name_to_key(order_id, "orderRejectReason"),
    )
    return Object.assign(
      {
        orderId: order_id,
        symbol: values[0],
        side: values[1],
        orderType: values[2],
        orderStatus: values[3],
        completed: values[4],
        total_executed_quantity: values[5],
        cancelled: values[6],
        orderRejectReason: values[7]
      },
    )
  }

  async print(order_id: string) {
    const object = await this.get_state_as_object(order_id)
    this.logger.info(
      `${object.symbol} ${object.side} ${object.orderType} ORDER #${object.orderId} (${object.orderStatus})`
    );
    console.dir(object);
  }
}
