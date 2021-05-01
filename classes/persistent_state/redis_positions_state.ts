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

// We store as integers in redis because it uses hardware for floating point calculations
function to_sats(input: string | BigNumber) {
  return new BigNumber(input).times("1e8").toFixed()
}

function from_sats(input: string | BigNumber) {
  return new BigNumber(input).dividedBy("1e8").toFixed()
}
export class RedisPositionsState {
  logger: Logger;
  redis: any;
  setAsync: any;
  getAsync: any;
  delAsync: any;
  msetnxAsync: any;
  msetAsync: any;
  mgetAsync: any;
  incrbyAsync: any;
  decrbyAsync: any;

  constructor({ logger, redis }: { logger: Logger, redis: RedisClient }) {
    assert(logger);
    this.logger = logger;
    assert(redis);
    this.redis = redis;

    this.setAsync = promisify(this.redis.set).bind(this.redis);
    this.getAsync = promisify(this.redis.get).bind(this.redis);
    this.delAsync = promisify(this.redis.del).bind(this.redis);
    this.msetnxAsync = promisify(this.redis.msetnx).bind(this.redis);
    this.msetAsync = promisify(this.redis.mset).bind(this.redis);
    this.mgetAsync = promisify(this.redis.mget).bind(this.redis);
    this.incrbyAsync = promisify(this.redis.incrby).bind(this.redis);
    this.decrbyAsync = promisify(this.redis.decrby).bind(this.redis);
  }

  name_to_key({ symbol, name, exchange, account }: { symbol: string, name: string, exchange: string, account: string }) {
    switch (name) {
      case "position_size":
        return `positions:${exchange}:${account}:${symbol}:sats_position_size`;
      case "initial_entry_price":
        return `positions:${exchange}:${account}:${symbol}:sats_initial_entry_price`;
      case "netQuoteBalanceChange":
        return `positions:${exchange}:${account}:${symbol}:sats_netQuoteBalanceChange`;
      default:
        throw new Error(`Unknown key name: ${name}`);
    }
  }

  async set_position_size({ symbol, position_size, exchange, account }: { symbol: string, position_size: BigNumber, exchange: string, account: string }): Promise<void> {
    try {
      await this.msetAsync(
        this.name_to_key({ symbol, exchange, account, name: "position_size" }), to_sats(position_size.toFixed())
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
    return new BigNumber(from_sats(await this.getAsync(key) || "0"))
  }

  async create_new_position(
    { symbol, exchange, account }: { symbol: string, exchange: string, account: string },
    { position_size, initial_entry_price, quote_invested }: { position_size: BigNumber, initial_entry_price?: BigNumber, quote_invested: BigNumber }) {
    try {
      await this.msetAsync(
        this.name_to_key({ symbol, exchange, account, name: "position_size" }), to_sats(position_size.toFixed()),
      )
      if (initial_entry_price) await this.msetAsync(
        this.name_to_key({ symbol, exchange, account, name: "initial_entry_price" }), to_sats(initial_entry_price?.toFixed()),
      )
      if (quote_invested) await this.msetAsync(
        this.name_to_key({ symbol, exchange, account, name: "netQuoteBalanceChange" }), to_sats(quote_invested?.toFixed())
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
        this.name_to_key({ symbol, exchange, account, name: "position_size" }), to_sats(amount.toFixed())
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

  async decrease_position_size_by(
    { symbol, exchange, account }: { symbol: string, exchange: string, account: string },
    amount: BigNumber): Promise<string> {
    try {
      return await this.decrbyAsync(
        this.name_to_key({ symbol, exchange, account, name: "position_size" }), to_sats(amount.toFixed())
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

  async close_position({ symbol, exchange, account }: { symbol: string, exchange: string, account: string }) {
    try {
      await this.delAsync(this.name_to_key({ symbol, exchange, account, name: "position_size" }))
      await this.delAsync(this.name_to_key({ symbol, exchange, account, name: "initial_entry_price" }))
      await this.delAsync(this.name_to_key({ symbol, exchange, account, name: "netQuoteBalanceChange" }))
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
}
