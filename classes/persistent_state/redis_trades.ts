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

export class RedisTrades {
  logger: Logger;
  redis: any;
  get_redis_key: any;
  getAsync: any;
  mgetAsync: any;
  keysAsync: any

  constructor({ logger, redis }: { logger: Logger, redis: RedisClient }) {
    assert(logger);
    this.logger = logger;
    assert(redis);
    this.redis = redis;

    this.get_redis_key = promisify(this.redis.get).bind(this.redis);
    this.getAsync = promisify(this.redis.get).bind(this.redis);
    this.mgetAsync = promisify(this.redis.mget).bind(this.redis);
    this.keysAsync = promisify(this.redis.keys).bind(this.redis);
  }

  async sorted_trade_ids() {
    const keys = await this.keysAsync("trades:*:completed");
    return keys.map((key: any) => parseInt(key.match(/:(\d+):/)[1])).sort((a: any, b: any) => a - b)
  }

  async get_active_order_ids() {
    let trade_ids = await this.sorted_trade_ids()
    const result: string[] = []
    for (const trade_id of trade_ids) {
      const completed = (await this.getAsync(`trades:${trade_id}:completed`)) === "true";
      if (completed) result.push(trade_id)
    }
    return result
  }
}
