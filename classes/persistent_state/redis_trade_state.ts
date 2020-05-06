

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
import { TradeDefinition, TradeDefinitionInputSpec } from '../specifications/trade_definition';

enum Name {
  trade_state_schema_version = 'trade_state_schema_version',
  buyOrderId = 'buyOrderId',
  stopOrderId = 'stopOrderId',
  targetOrderId = 'targetOrderId',
  base_amount_imported = 'base_amount_imported',
  base_amount_bought = 'base_amount_bought',
  base_amount_sold = 'base_amount_sold',
  target_base_amount_to_buy = 'target_base_amount_to_buy',
  buying_allowed = 'buying_allowed',
  trade_completed = 'trade_completed',
  trade_definition = 'trade_definition',
}

function name_to_key(trade_id: string, name: Name): string {
  switch (name) {
    case Name.buyOrderId:
      return `trades:${trade_id}:open_orders:buyOrderId`;
    case Name.stopOrderId:
      return `trades:${trade_id}:open_orders:stopOrderId`;
    case Name.targetOrderId:
      return `trades:${trade_id}:open_orders:targetOrderId`;
    case Name.base_amount_imported:
      return `trades:${trade_id}:position:base_amount_imported`;
    case Name.base_amount_bought:
      return `trades:${trade_id}:position:base_amount_bought`;
    case Name.base_amount_sold:
      return `trades:${trade_id}:position:base_amount_sold`;
    case Name.target_base_amount_to_buy:
      return `trades:${trade_id}:position:target_base_amount_to_buy`;
    case Name.buying_allowed:
      return `trades:${trade_id}:buying_allowed`;
    case Name.trade_completed:
      return `trades:${trade_id}:completed`;
    case Name.trade_state_schema_version:
      return `trades:${trade_id}:trade_state_schema_version`;
    case Name.trade_definition:
      return `trades:${trade_id}:trade_definition`;
    default:
      throw new Error(`Unknown key name`);
  }
}

export class TradeState {
  logger: Logger
  redis: RedisClient
  trade_id: string
  _get_redis_key: (key: string) => Promise<string>
  set_redis_key: (key: string, value: string) => Promise<string>
  delAsync: (key: string) => Promise<string>
  mgetAsync: (...args: string[]) => Promise<string[]>

  constructor({ logger, redis, trade_id }: { logger: Logger, redis: RedisClient, trade_id: string }) {
    // NB: base_amount_imported is handled by initialiser()
    assert(logger);
    this.logger = logger;
    assert(redis);
    this.redis = redis;
    assert(trade_id);
    this.trade_id = trade_id;

    this.set_redis_key = promisify(this.redis.set).bind(this.redis);
    this._get_redis_key = promisify(this.redis.get).bind(this.redis);
    this.delAsync = promisify(this.redis.del).bind(this.redis);
    this.mgetAsync = promisify(this.redis.mget).bind(this.redis);
  }

  name_to_key(key: Name) {
    return name_to_key(this.trade_id, key)
  }

  async get_redis_key(key: string) {
    const ret = await this._get_redis_key(key)
    if(ret === 'undefined') {
      throw new Error(`Redis error: key ${key} is the string 'undefined'`)
    }
    return ret
  }

  async set_or_delete_key(key: string, value: string | undefined) {
    this.logger.info(`Setting ${key} to ${value}`);
    if (value === undefined) {
      return await this.delAsync(key);
    }
    // TODO: change to only set if not defined, throw otherwise - to prevent concurrent runs interacting
    return await this.set_redis_key(key, value);
  }

  async set_buyOrderId(value: string | undefined) {
    return await this.set_or_delete_key(this.name_to_key(Name.buyOrderId), value);
  }

  async set_stopOrderId(value: string | undefined) {
    return await this.set_or_delete_key(this.name_to_key(Name.stopOrderId), value);
  }

  async set_targetOrderId(value: string | undefined) {
    return await this.set_or_delete_key(this.name_to_key(Name.targetOrderId), value);
  }

  async get_buyOrderId(): Promise<string | undefined> {
    const key = this.name_to_key(Name.buyOrderId);
    const value = await this.get_redis_key(key);
    // this.logger.info(`${key} has value ${value}`);
    if (!value) {
      return undefined; // convert null to undefined
    }
    return value;
  }

  async get_stopOrderId(): Promise<string | undefined> {
    const key = this.name_to_key(Name.stopOrderId);
    const value = await this.get_redis_key(key);
    // this.logger.info(`${key} has value ${value}`);
    if (!value) {
      return undefined; // convert null to undefined
    }
    return value;
  }

  async get_targetOrderId(): Promise<string | undefined> {
    const key = this.name_to_key(Name.targetOrderId);
    const value = await this.get_redis_key(key);
    // this.logger.info(`${key} has value ${value}`);
    if (!value) {
      return undefined; // convert null to undefined
    }
    return value;
  }

  async set_trade_completed(value: Boolean) {
    assert(value === true);
    const key = this.name_to_key(Name.trade_completed);
    return await this.set_redis_key(key, `${value}`);
  }

  async get_trade_completed() {
    const key = this.name_to_key(Name.trade_completed);
    return stringToBool(await this.get_redis_key(key));
  }

  async set_buying_allowed(value: Boolean) {
    const key = this.name_to_key(Name.buying_allowed);
    return await this.set_redis_key(key, `${value}`);
  }

  async get_buying_allowed() {
    const key = this.name_to_key(Name.buying_allowed);
    return stringToBool(await this.get_redis_key(key));
  }

  async get_base_amount_held() {
    let sum = new BigNumber(0)
    sum = sum.plus((await this.get_redis_key(this.name_to_key(Name.base_amount_imported))) || 0)
    sum = sum.plus((await this.get_redis_key(this.name_to_key(Name.base_amount_bought))) || 0)
    sum = sum.minus((await this.get_redis_key(this.name_to_key(Name.base_amount_sold))) || 0)
    return sum;
  }

  async set_base_amount_imported(bignum_value: BigNumber) {
    const key = this.name_to_key(Name.base_amount_imported);
    await this.set_redis_key(key, bignum_value.toFixed());
  }

  async set_base_amount_bought(bignum_value: BigNumber) {
    const key = this.name_to_key(Name.base_amount_bought);
    await this.set_redis_key(key, bignum_value.toFixed());
  }

  async set_base_amount_sold(bignum_value: BigNumber) {
    const key = this.name_to_key(Name.base_amount_sold);
    await this.set_redis_key(key, bignum_value.toFixed());
  }

  async set_target_base_amount_to_buy(bignum_value: BigNumber) {
    const key = this.name_to_key(Name.target_base_amount_to_buy);
    await this.set_redis_key(key, bignum_value.toFixed());
  }

  async get_target_base_amount_to_buy(): Promise<BigNumber | undefined> {
    const key = this.name_to_key(Name.target_base_amount_to_buy);
    const value = await this.get_redis_key(key)
    return value ? new BigNumber(value) : undefined
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

  async get_order_ids() {
    const [buyOrderId, stopOrderId, targetOrderId] = await this.mgetAsync(this.name_to_key(Name.buyOrderId), this.name_to_key(Name.stopOrderId), this.name_to_key(Name.targetOrderId))
    return { buyOrderId, stopOrderId, targetOrderId }
  }

  // A v2 of the interface developed while creating tests
  // chosen because they are very readable in the tests and could also allow us 
  // to store more semantic data in the state if we choose later
  async add_buy_order({ orderId }: { orderId: string }) {
    await this.set_buyOrderId(orderId)
  }

  async add_stop_order({ orderId }: { orderId: string }) {
    await this.set_stopOrderId(orderId)
  }

  async fully_filled_buy_order({ orderId, total_base_amount_bought }: { orderId: string, total_base_amount_bought: BigNumber }) {
    assert.strictEqual(orderId, await this.get_buyOrderId())
    this.logger.warn('redis updates should be atomic') // including check for expected orderId
    await this.set_redis_key('buying_allowed', 'false')
    await this.set_buyOrderId(undefined)
    await this.set_base_amount_bought(total_base_amount_bought)
  }
}

export interface RedisTradeStateInitialiserParams {
  logger: Logger;
  redis: RedisClient;
  trade_id: string;
}

// factory. Could probably be turned into a class constructor again now but then we loose the ability to put async code in here
export async function build_trade_state_for_trade_id(params: RedisTradeStateInitialiserParams): Promise<TradeState> {
  return new TradeState(params);
}

interface CreateTradeParams {
  logger: Logger, redis: RedisClient,
  trade_definition: TradeDefinition // use the class here to force validation upstream
}

// creates in redis
export async function create_new_trade(params: CreateTradeParams): Promise<string> {
  const { logger, redis, trade_definition } = params;
  assert(redis);
  assert(logger);
  assert(trade_definition);

  const hmsetAsync = promisify(redis.hmset).bind(redis);
  const msetAsync = promisify(redis.mset).bind(redis);
  const incrAsync = promisify(redis.incr).bind(redis);

  const trade_id = await incrAsync("trades:next:trade_id");

  logger.info(inspect(trade_definition));

  const obj = trade_definition.serialised_to_simple_object() as any
  let ret = await hmsetAsync(name_to_key(trade_id, Name.trade_definition),
    _.pickBy(obj), (key: string) => obj[key] !== undefined);
  if (ret !== "OK") throw new Error(`Failed to save trade to redis`)

  ret = await msetAsync(
    name_to_key(trade_id, Name.trade_state_schema_version), 'v1',
    name_to_key(trade_id, Name.base_amount_imported), trade_definition.base_amount_imported,
    name_to_key(trade_id, Name.buying_allowed), trade_definition.unmunged.hasOwnProperty('buy_price') ? true : false,
    name_to_key(trade_id, Name.trade_completed), false
  );
  if (ret !== "OK") throw new Error(`Failed to save trade to redis`)

  logger.info(`TradeState setting base_amount_imported (${trade_definition.base_amount_imported})`)
  return trade_id;
}
