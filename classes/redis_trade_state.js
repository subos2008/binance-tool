const assert = require("assert");
const { promisify } = require("util");

function name_to_key(name) {
  switch (name) {
    case "buyOrderId":
      return `trades:${this.trade_id}:open_orders:buyOrderId`;
    case "stopOrderId":
      return `trades:${this.trade_id}:open_orders:stopOrderId`;
    case "targetOrderId":
      return `trades:${this.trade_id}:open_orders:targetOrderId`;
    default:
      throw new Error(`Unknown key name`);
  }
}

var stringToBool = myValue => myValue === "true";

const BigNumber = require("bignumber.js");
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
  throw Error("BigNumber .valueOf called!");
};

class TradeState {
  constructor({ logger, redis, trade_id } = {}) {
    assert(logger);
    this.logger = logger;
    assert(redis);
    this.redis = redis;
    assert(trade_id);
    this.trade_id = trade_id;

    this.set_redis_key = promisify(this.redis.set).bind(this.redis);
    this.get_redis_key = promisify(this.redis.get).bind(this.redis);
    this.delAsync = promisify(this.redis.del).bind(this.redis);
  }

  async set_or_delete_key(key, value) {
    if (value == 0) {
      // we use !value in logic to detect null
      throw new Error(`value of zero not supported`);
    }
    this.logger.info(`Setting ${key} to ${value}`);
    if (value === undefined) {
      return this.delAsync(key);
    }
    // TODO: change to only set if not defined, throw otherwise - to prevent concurrent runs interacting
    return await this.set_redis_key(key, value);
  }

  async set_buyOrderId(value) {
    return this.set_or_delete_key(name_to_key("buyOrderId"), value);
  }

  async set_stopOrderId(value) {
    return this.set_or_delete_key(name_to_key("stopOrderId"), value);
  }

  async set_targetOrderId(value) {
    return this.set_or_delete_key(name_to_key("targetOrderId"), value);
  }

  async get_buyOrderId() {
    const key = name_to_key("buyOrderId");
    const value = await this.get_redis_key(key);
    this.logger.info(`${key} has value ${value}`);
    if (!value) {
      return undefined; // convert null to undefined
    }
    return Number(value);
  }

  async get_stopOrderId() {
    const key = name_to_key("stopOrderId");
    const value = await this.get_redis_key(key);
    this.logger.info(`${key} has value ${value}`);
    if (!value) {
      return undefined; // convert null to undefined
    }
    return Number(value);
  }

  async get_targetOrderId() {
    const key = name_to_key("targetOrderId");
    const value = await this.get_redis_key(key);
    this.logger.info(`${key} has value ${value}`);
    if (!value) {
      return undefined; // convert null to undefined
    }
    return Number(value);
  }

  async set_trade_completed(value) {
    assert(value === true);
    const key = `trades:${this.trade_id}:trade_completed`;
    return await this.set_redis_key(key, value);
  }

  async get_trade_completed() {
    return stringToBool(
      await this.get_redis_key(`trades:${this.trade_id}:trade_completed`)
    );
  }

  // returns BigNumber, 0 on null
  async get_base_amount_held() {
    return (
      BigNumber(
        await this.get_redis_key(
          `trades:${this.trade_id}:position:base_amount_held`
        )
      ) || 0
    );
  }

  async set_base_amount_held(bignum_value) {
    await this.set_redis_key(
      `trades:${this.trade_id}:position:base_amount_held`,
      bignum_value.toFixed()
    );
  }
}

module.exports = TradeState;
