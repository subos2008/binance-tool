const assert = require("assert");
const { promisify } = require("util");

function name_to_key(name) {
  switch (name) {
    case "buyOrderId":
      return `trades:${this.trade_id}:open_orders:buyOrderId`;
    default:
      throw new Error(`Unknown key name`);
  }
}

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

  async set_buyOrderId(buyOrderId) {
    if (buyOrderId == 0) {
      throw new Error(`orderId of zero not supported`);
    }
    const key = name_to_key("buyOrderId");
    this.logger.info(`Setting ${key} to ${buyOrderId}`);
    if (buyOrderId === undefined) {
      // TODO: remove this await
      return await this.delAsync(key);
    }
    // TODO: change to only set if not defined, throw otherwise
    // TODO: remove this await
    await this.set_redis_key(key, buyOrderId);
    console.log(await this.get_redis_key(key));
    return;
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

  async set_trade_completed(value) {
    assert(value === true);
    const key = `trades:${this.trade_id}:trade_completed`;
    return await this.set_redis_key(key, value);
  }

  async get_trade_completed() {
    return await this.get_redis_key(`trades:${this.trade_id}:trade_completed`);
  }
}

module.exports = TradeState;
