
import * as Sentry from '@sentry/node';

import { strict as assert } from 'assert';
const { promisify, inspect } = require("util");
var _ = require("lodash");

var stringToBool = (myValue: string) => myValue === "true";

import BigNumber from 'bignumber.js';
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

import { Logger } from '../../interfaces/logger'
import { RedisClient } from 'redis'

export class SymbolPrices {
  logger: Logger
  redis: RedisClient
  exchange_name: string
  seconds: number
  _get_redis_key: (key: string) => Promise<string>
  _setex_redis_key: (key: string, seconds: number, value: string) => Promise<string>

  constructor({ logger, redis, exchange_name, seconds }: { logger: Logger, redis: RedisClient, exchange_name: string, seconds: number | null }) {
    assert(logger);
    this.logger = logger;
    assert(redis);
    this.redis = redis;
    assert(exchange_name);
    this.exchange_name = exchange_name;
    this.seconds = seconds || 60; // seconds before keys expire

    this._setex_redis_key = promisify(this.redis.setex).bind(this.redis);
    this._get_redis_key = promisify(this.redis.get).bind(this.redis);
  }

  symbol_to_key(symbol: string) {
    return `symbol_prices:${this.exchange_name}:${symbol}`
  }

  async get_redis_key(key: string): Promise<string> {
    let ret;
    try {
      ret = await this._get_redis_key(key)
    } catch (err) {
      Sentry.withScope(function (scope: any) {
        scope.setTag("redis-key", key);
        scope.setTag("redis-operation", 'get');
        Sentry.captureException(err);
      });
      throw (err)
    }
    if (ret === 'undefined') {
      throw new Error(`Redis error: key ${key} is the string 'undefined'`)
    }
    return ret
  }

  async set_redis_key(key: string, value: string) {
    if (value === 'undefined') {
      throw new Error(`Redis error: attempt to set key ${key} to the string 'undefined'`)
    }
    // assert key is in our namespace:
    assert(key.startsWith(`symbol_prices:${this.exchange_name}:`), `Attempt to set key outside namespace: ${key}`)
    let ret = "ERROR: wibble"
    try {
      ret = await this._setex_redis_key(key, this.seconds, value)
    } catch (err) {
      // I don't think this will work as we don't see the exception here
      Sentry.withScope(function (scope: any) {
        scope.setTag("redis-key", key);
        scope.setTag("redis-operation", 'set');
        Sentry.captureException(err);
        throw (err)
      });
    }
    if (ret !== 'OK') {
      throw new Error(`Redis error: failed to set key ${key}: ${ret}`)
    }
    return ret
  }

  async set_price(symbol: string, price: BigNumber): Promise<void> {
    let ret = await this.set_redis_key(this.symbol_to_key(symbol), price.toFixed());
    if (ret != 'OK') throw new Error(`Redis error: failed to set price for ${symbol} to ${price}`)
  }

  async get_price(symbol: string): Promise<BigNumber | undefined> {
    const key = this.symbol_to_key(symbol);
    const value = await this.get_redis_key(key);
    if (value === null) {
      return undefined; // convert null to undefined
    }
    return new BigNumber(value);
  }
}
