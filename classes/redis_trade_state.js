const assert = require("assert");
const { promisify } = require("util");
var _ = require("lodash");

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

  name_to_key(name) {
    switch (name) {
      case "buyOrderId":
        return `trades:${this.trade_id}:open_orders:buyOrderId`;
      case "stopOrderId":
        return `trades:${this.trade_id}:open_orders:stopOrderId`;
      case "targetOrderId":
        return `trades:${this.trade_id}:open_orders:targetOrderId`;
      case "base_amount_imported":
        return `trades:${this.trade_id}:position:base_amount_imported`;
      case "base_amount_bought":
        return `trades:${this.trade_id}:position:base_amount_bought`;
      case "base_amount_sold":
        return `trades:${this.trade_id}:position:base_amount_sold`;
      case "trade_completed":
        return `trades:${this.trade_id}:completed`;
      default:
        throw new Error(`Unknown key name`);
    }
  }

  async set_or_delete_key(key, value) {
    if (value == 0) {
      // we use !value in logic to detect null
      throw new Error(`value of zero not supported`);
    }
    this.logger.info(`Setting ${key} to ${value}`);
    if (value === undefined) {
      return await this.delAsync(key);
    }
    // TODO: change to only set if not defined, throw otherwise - to prevent concurrent runs interacting
    return await this.set_redis_key(key, value);
  }

  async set_buyOrderId(value) {
    return await this.set_or_delete_key(this.name_to_key("buyOrderId"), value);
  }

  async set_stopOrderId(value) {
    return await this.set_or_delete_key(this.name_to_key("stopOrderId"), value);
  }

  async set_targetOrderId(value) {
    return await this.set_or_delete_key(this.name_to_key("targetOrderId"), value);
  }

  async get_buyOrderId() {
    const key = this.name_to_key("buyOrderId");
    const value = await this.get_redis_key(key);
    // this.logger.info(`${key} has value ${value}`);
    if (!value) {
      return undefined; // convert null to undefined
    }
    return Number(value);
  }

  async get_stopOrderId() {
    const key = this.name_to_key("stopOrderId");
    const value = await this.get_redis_key(key);
    // this.logger.info(`${key} has value ${value}`);
    if (!value) {
      return undefined; // convert null to undefined
    }
    return Number(value);
  }

  async get_targetOrderId() {
    const key = this.name_to_key("targetOrderId");
    const value = await this.get_redis_key(key);
    // this.logger.info(`${key} has value ${value}`);
    if (!value) {
      return undefined; // convert null to undefined
    }
    return Number(value);
  }

  async set_trade_completed(value) {
    assert(value === true);
    const key = this.name_to_key("trade_completed");
    return await this.set_redis_key(key, value);
  }

  async get_trade_completed() {
    const key = this.name_to_key("trade_completed");
    return stringToBool(await this.get_redis_key(key));
  }

  async get_base_amount_held() {
    let sum = BigNumber(0)
    sum = sum.plus((await this.get_redis_key(this.name_to_key("base_amount_imported"))) || 0)
    sum = sum.plus((await this.get_redis_key(this.name_to_key("base_amount_bought"))) || 0)
    sum = sum.minus((await this.get_redis_key(this.name_to_key("base_amount_sold"))) || 0)
    return sum;
  }

  async set_base_amount_imported(bignum_value) {
    const key = this.name_to_key("base_amount_imported");
    await this.set_redis_key(key, bignum_value.toFixed());
  }

  async set_base_amount_bought(bignum_value) {
    const key = this.name_to_key("base_amount_bought");
    await this.set_redis_key(key, bignum_value.toFixed());
  }

  async set_base_amount_sold(bignum_value) {
    const key = this.name_to_key("base_amount_sold");
    await this.set_redis_key(key, bignum_value.toFixed());
  }

  async print() {
    const base_amount_held = await this.get_base_amount_held();
    const trade_completed = await this.get_trade_completed();
    const targetOrderId = await this.get_targetOrderId();
    const stopOrderId = await this.get_stopOrderId();
    const buyOrderId = await this.get_buyOrderId();
    console.dir(
      Object.assign(
        {
          base_amount_held: base_amount_held
            ? base_amount_held.toFixed()
            : null,
          trade_completed,
          targetOrderId,
          stopOrderId,
          buyOrderId
        },
        _.pick(this, ["trade_id"])
      )
    );
  }
}

async function initialiser(params = {}) {
  const { logger, redis, trade_id, base_amount_imported, base_amount_held } = params;
  assert(redis);
  assert(trade_id);
  assert(logger);
  assert(base_amount_imported); // BigNumber
  assert(base_amount_held === null); // depricated
  const trade_state = new TradeState({ logger, redis, trade_id });
  await trade_state.set_base_amount_imported(base_amount_imported);
}

// a bit unorthodox maybe ;-/
module.exports = { TradeState, initialiser };
