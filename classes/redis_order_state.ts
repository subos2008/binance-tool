const assert = require("assert");
const { promisify } = require("util");

var stringToBool = (myValue: string) => myValue === "true";

import { Logger } from '../interfaces/logger'
import { BigNumber } from 'bignumber.js';
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

export class OrderState {
  logger: Logger;
  redis: any;
  set_redis_key: any;
  get_redis_key: any;
  delAsync: any;

  constructor({ logger, redis }: { logger: Logger, redis: any }) {
    assert(logger);
    this.logger = logger;
    assert(redis);
    this.redis = redis;

    this.set_redis_key = promisify(this.redis.set).bind(this.redis);
    this.get_redis_key = promisify(this.redis.get).bind(this.redis);
    this.delAsync = promisify(this.redis.del).bind(this.redis);
  }

  name_to_key(order_id: string, name: string) {
    switch (name) {
      case "completed":
        return `trades:${order_id}:completed`;
      default:
        throw new Error(`Unknown key name: ${name}`);
    }
  }

  async set_or_delete_key(key: string, value: string | undefined): Promise<void> {
    this.logger.info(`Setting ${key} to ${value}`);
    if (value === undefined) {
      return this.delAsync(key);
    }
    // TODO: [old comment] change to only set if not defined, throw otherwise - to prevent concurrent runs interacting
    return await this.set_redis_key(key, value);
  }

  async set_total_executed_quantity(order_id: string, value: BigNumber): Promise<void> {
    return await this.set_or_delete_key(this.name_to_key(order_id, "targetOrderId"), value.toFixed());
  }

  async get_total_executed_quantity(order_id: string): Promise<BigNumber> {
    const key = this.name_to_key(order_id, "total_executed_quantity");
    return new BigNumber((await this.get_redis_key(key)) || 0);
  }

  async set_order_completed(order_id: string, value: Boolean): Promise<void> {
    assert(value === true);
    const key = this.name_to_key(order_id, "completed");
    return await this.set_redis_key(key, value);
  }

  async get_order_completed(order_id: string): Promise<Boolean> {
    const key = this.name_to_key(order_id, "completed");
    return stringToBool(await this.get_redis_key(key));
  }

  async print(order_id: string) {
    const total_executed_quantity = await this.get_total_executed_quantity(order_id);
    const order_completed = await this.get_order_completed(order_id);
    console.dir(
      Object.assign(
        {
          total_executed_quantity: total_executed_quantity
            ? total_executed_quantity.toFixed()
            : null,
          order_completed,
        },
      )
    );
  }
}
