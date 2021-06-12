import { strict as assert } from "assert"
const { promisify } = require("util")

import { Logger } from "../../interfaces/logger"
import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import * as Sentry from "@sentry/node"

import { RedisClient } from "redis"
import { PositionIdentifier } from "../../events/shared/position-identifier"
import { PositionObject } from "../../classes/position"
import { GenericOrderData } from "../../types/exchange_neutral/generic_order_data"

// We store as integers in redis because it uses hardware for floating point calculations
function to_sats(input: string | BigNumber): string {
  return new BigNumber(input).times("1e8").toFixed()
}

function from_sats(input: string | BigNumber) {
  return new BigNumber(input).dividedBy("1e8").toFixed()
}

const key_base = "positions-v2"
export class RedisPositionsState {
  logger: Logger
  redis: RedisClient
  setAsync: any
  getAsync: any
  delAsync: any
  msetnxAsync: any
  msetAsync: any
  mgetAsync: any
  incrbyAsync: any
  decrbyAsync: any
  keysAsync: any
  smembersAsync: any
  saddAsync: any

  constructor({ logger, redis }: { logger: Logger; redis: RedisClient }) {
    assert(logger)
    this.logger = logger
    assert(redis)
    this.redis = redis

    this.setAsync = promisify(this.redis.set).bind(this.redis)
    this.getAsync = promisify(this.redis.get).bind(this.redis)
    this.delAsync = promisify(this.redis.del).bind(this.redis)
    this.msetnxAsync = promisify(this.redis.msetnx).bind(this.redis)
    this.msetAsync = promisify(this.redis.mset).bind(this.redis)
    this.mgetAsync = promisify(this.redis.mget).bind(this.redis)
    this.incrbyAsync = promisify(this.redis.incrby).bind(this.redis)
    this.decrbyAsync = promisify(this.redis.decrby).bind(this.redis)
    this.keysAsync = promisify(this.redis.keys).bind(this.redis)
    this.smembersAsync = promisify(this.redis.smembers).bind(this.redis)
    this.saddAsync = promisify(this.redis.sadd).bind(this.redis)
  }

  private prefix(pi: PositionIdentifier) {
    return `${key_base}:${pi.exchange_identifier.exchange}:${pi.exchange_identifier.account}:${pi.baseAsset}`
  }

  name_to_key(pi: PositionIdentifier, { name }: { name: string }) {
    let prefix = this.prefix(pi)
    switch (name) {
      case "position_size":
      case "initial_entry_price":
      case "initial_quote_invested":
      case "total_quote_invested":
      case "total_quote_withdrawn":
        return `${prefix}:sats_${name}`
      default:
        return `${prefix}:${name}`
    }
  }

  async set_position_size(pi: PositionIdentifier, { position_size }: { position_size: BigNumber }): Promise<void> {
    try {
      await this.msetAsync(this.name_to_key(pi, { name: "position_size" }), to_sats(position_size.toFixed()))
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.baseAsset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        scope.setTag("account", pi.exchange_identifier.account)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async get_sats_key(pi: PositionIdentifier, { key_name }: { key_name: string }): Promise<BigNumber> {
    const key = this.name_to_key(pi, { name: key_name })
    const sats_or_null = await this.getAsync(key)
    if (!sats_or_null) throw new Error(`${key} missing from position`)
    return new BigNumber(from_sats(sats_or_null))
  }

  async get_string_key(pi: PositionIdentifier, { key_name }: { key_name: string }): Promise<string> {
    const key = this.name_to_key(pi, { name: key_name })
    const value = await this.getAsync(key)
    if (!value) throw new Error(`${key} missing from position`)
    return value
  }

  async get_number_key(pi: PositionIdentifier, { key_name }: { key_name: string }): Promise<number> {
    const key = this.name_to_key(pi, { name: key_name })
    const value = await this.getAsync(key)
    if (!value) throw new Error(`${key} missing from position`)
    return Number(value)
  }

  async get_position_size(pi: PositionIdentifier): Promise<BigNumber> {
    try {
      return await this.get_sats_key(pi, { key_name: "position_size" })
    } catch (e) {
      return new BigNumber(0)
    }
  }

  async get_initial_entry_price(pi: PositionIdentifier): Promise<BigNumber> {
    return this.get_sats_key(pi, { key_name: "initial_entry_price" })
  }

  async get_initial_entry_quote_asset(pi: PositionIdentifier): Promise<string> {
    return this.get_string_key(pi, { key_name: "initial_entry_quote_asset" })
  }

  async get_initial_entry_timestamp(pi: PositionIdentifier): Promise<number> {
    return this.get_number_key(pi, { key_name: "initial_entry_timestamp" })
  }

  async get_initial_quote_invested(pi: PositionIdentifier): Promise<BigNumber> {
    return this.get_sats_key(pi, { key_name: "initial_quote_invested" })
  }

  private async get_object_set_key(pi: PositionIdentifier, { key_name }: { key_name: string }) {
    let objects_as_strings: string[] = await this.smembersAsync(this.name_to_key(pi, { name: key_name }))
    let objects = objects_as_strings.map((s) => JSON.parse(s))
    return objects
  }

  private async add_objects_to_set_key(
    pi: PositionIdentifier,
    { key_name, new_objects }: { key_name: string; new_objects: any[] }
  ): Promise<void> {
    let strings: string[] = new_objects.map((o) => JSON.stringify(o, Object.keys(o).sort()))
    await this.saddAsync(this.name_to_key(pi, { name: key_name }), strings)
  }

  async add_orders(pi: PositionIdentifier, orders: GenericOrderData[]): Promise<void> {
    return this.add_objects_to_set_key(pi, { key_name: "orders", new_objects: orders })
  }

  async get_orders(pi: PositionIdentifier): Promise<GenericOrderData[]> {
    return this.get_object_set_key(pi, { key_name: "orders" })
  }

  async describe_position(pi: PositionIdentifier): Promise<PositionObject> {
    return {
      position_size: await this.get_position_size(pi),
      initial_entry_price: await this.get_initial_entry_price(pi),
      initial_entry_quote_asset: await this.get_initial_entry_quote_asset(pi),
      initial_quote_invested: await this.get_initial_quote_invested(pi),
      initial_entry_timestamp: await this.get_initial_entry_timestamp(pi),
      orders: await this.get_orders(pi),
    }
  }

  async create_new_position(
    pi: PositionIdentifier,
    {
      position_size,
      initial_entry_price,
      initial_quote_invested,
      initial_entry_quote_asset,
      initial_entry_timestamp,
      orders,
    }: PositionObject
  ) {
    try {
      assert(initial_quote_invested.isPositive())
      await this.add_orders(pi, orders)
      await this.msetAsync(
        this.name_to_key(pi, { name: "initial_entry_timestamp" }),
        initial_entry_timestamp,
        this.name_to_key(pi, { name: "position_size" }),
        to_sats(position_size.toFixed()),
        this.name_to_key(pi, { name: "initial_quote_invested" }),
        to_sats(initial_quote_invested?.toFixed()),
        this.name_to_key(pi, { name: "initial_entry_price" }),
        to_sats(initial_entry_price?.toFixed()),
        this.name_to_key(pi, { name: "initial_entry_quote_asset" }),
        initial_entry_quote_asset
      )
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.baseAsset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        scope.setTag("account", pi.exchange_identifier.account)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async _patch_initial_entry_quote_asset(pi: PositionIdentifier, { initial_entry_quote_asset }: any) {
    try {
      await this.msetAsync(this.name_to_key(pi, { name: "initial_entry_quote_asset" }), initial_entry_quote_asset)
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.baseAsset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        scope.setTag("account", pi.exchange_identifier.account)
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async _patch_initial_entry_timestamp(pi: PositionIdentifier, { initial_entry_timestamp }: any) {
    try {
      await this.msetAsync(this.name_to_key(pi, { name: "initial_entry_timestamp" }), initial_entry_timestamp)
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.baseAsset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        scope.setTag("account", pi.exchange_identifier.account)
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async adjust_position_size_by(
    pi: PositionIdentifier,
    { base_change }: { base_change: BigNumber }
  ): Promise<void> {
    try {
      console.log(`adjust_position_size_by start: ${await this.get_position_size(pi)}`)
      await this.incrbyAsync(this.name_to_key(pi, { name: "position_size" }), to_sats(base_change.toFixed()))
      console.log(`adjust_position_size_by after: ${await this.get_position_size(pi)}`)
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.baseAsset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        scope.setTag("account", pi.exchange_identifier.account)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async close_position(pi: PositionIdentifier) {
    try {
      let keys = await this.keysAsync(`${this.prefix(pi)}:*`)
      for (let key of keys) {
        await this.delAsync(key)
      }
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.baseAsset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        scope.setTag("account", pi.exchange_identifier.account)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async open_positions(): Promise<PositionIdentifier[]> {
    const keys = await this.keysAsync(`${key_base}:*:sats_position_size`)
    return keys.map((key: any) => {
      let tuple = key.match(/:([^:]+):([^:]+):([^:]+):sats_position_size/)
      let pi: PositionIdentifier = {
        exchange_identifier: { exchange: tuple[1], account: tuple[2] },
        baseAsset: tuple[3],
      }
      return pi
    })
  }
}
