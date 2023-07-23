import { strict as assert } from "assert"
import { Logger } from "../../../../../interfaces/logger"
import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import Sentry from "../../../../../lib/sentry"

import { RedisClientType } from "redis-v4"
import { SpotPositionIdentifier_V3, AuthorisedEdgeType } from "../../../abstractions/position-identifier"
import { SpotPositionObject } from "../../../abstractions/spot-position"
import { GenericOrderData } from "../../../../../types/exchange_neutral/generic_order_data"
import { SpotPositionInitialisationData } from "../../interface/spot-positions-persistance"
import { OrderId } from "../../../../persistent_state/interface/order-context-persistence"

// We store as integers in redis because it uses hardware for floating point calculations
function to_sats(input: string | BigNumber): string {
  return new BigNumber(input).times("1e8").toFixed(0)
}

function from_sats(input: string | BigNumber) {
  return new BigNumber(input).dividedBy("1e8").toFixed(8)
}

const key_base = "positions-v3"
export class RedisSpotPositionsState {
  logger: Logger
  redis: RedisClientType

  constructor({ logger, redis }: { logger: Logger; redis: RedisClientType }) {
    assert(logger)
    this.logger = logger
    assert(redis)
    this.redis = redis
  }

  private prefix(pi: SpotPositionIdentifier_V3) {
    assert.equal(pi.exchange_identifier.exchange_type, "spot")
    let account = "default"
    /* This needs to match the regexp in open_positions() */
    return `${key_base}:spot:${pi.exchange_identifier.exchange}:${account}:${pi.base_asset}:${pi.edge}`
  }

  name_to_key(pi: SpotPositionIdentifier_V3, { name }: { name: string }) {
    let prefix = this.prefix(pi)
    switch (name) {
      case "position_size":
      case "initial_entry_price":
      case "initial_entry_position_size":
      case "initial_quote_invested":
      case "total_quote_invested":
      case "total_quote_withdrawn":
      case "edge":
        return `${prefix}:sats_${name}` // oops left a sats in
      default:
        return `${prefix}:${name}`
    }
  }

  async set_position_size(
    pi: SpotPositionIdentifier_V3,
    { position_size }: { position_size: BigNumber }
  ): Promise<void> {
    try {
      let key = this.name_to_key(pi, { name: "position_size" })
      let value = to_sats(position_size.toFixed())
      await this.redis.set(key, value)
    } catch (err) {
      console.error(err)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.base_asset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(err)
      })
      throw err
    }
  }

  async get_sats_key(pi: SpotPositionIdentifier_V3, { key_name }: { key_name: string }): Promise<BigNumber> {
    const key = this.name_to_key(pi, { name: key_name })
    const sats_or_null = await this.redis.get(key)
    if (!sats_or_null) throw new Error(`${key} missing from position`)
    return new BigNumber(from_sats(sats_or_null))
  }

  async get_string_key(
    pi: SpotPositionIdentifier_V3,
    { key_name, null_allowed }: { key_name: string; null_allowed: boolean }
  ): Promise<string | null> {
    const key = this.name_to_key(pi, { name: key_name })
    const value = await this.redis.get(key)
    if (!value && !null_allowed) throw new Error(`${key} missing from position`)
    return value
  }

  async get_string_key_no_null(
    pi: SpotPositionIdentifier_V3,
    { key_name }: { key_name: string }
  ): Promise<string> {
    const key = this.name_to_key(pi, { name: key_name })
    const value = await this.redis.get(key)
    if (!value) throw new Error(`${key} missing from position`)
    return value
  }

  async set_string_key(
    pi: SpotPositionIdentifier_V3,
    { key_name }: { key_name: string },
    value: string
  ): Promise<void> {
    const key = this.name_to_key(pi, { name: key_name })
    await this.redis.set(key, value)
    console.log(`Set ${key} to ${value}`)
  }

  async get_number_key(pi: SpotPositionIdentifier_V3, { key_name }: { key_name: string }): Promise<number> {
    const key = this.name_to_key(pi, { name: key_name })
    const value = await this.redis.get(key)
    if (!value) throw new Error(`${key} missing from position`)
    return Number(value)
  }

  async get_position_size(pi: SpotPositionIdentifier_V3): Promise<BigNumber> {
    try {
      return await this.get_sats_key(pi, { key_name: "position_size" })
    } catch (e) {
      return new BigNumber(0)
    }
  }

  async get_initial_entry_price(pi: SpotPositionIdentifier_V3): Promise<BigNumber> {
    return this.get_sats_key(pi, { key_name: "initial_entry_price" })
  }

  async get_initial_entry_position_size(pi: SpotPositionIdentifier_V3): Promise<BigNumber> {
    // The exception here ust means we called in_position on a position that doesn't exist
    return this.get_sats_key(pi, { key_name: "initial_entry_position_size" })
  }

  async get_initial_entry_quote_asset(pi: SpotPositionIdentifier_V3): Promise<string> {
    return this.get_string_key_no_null(pi, { key_name: "initial_entry_quote_asset" })
  }

  // ms
  async get_initial_entry_timestamp(pi: SpotPositionIdentifier_V3): Promise<number> {
    return this.get_number_key(pi, { key_name: "initial_entry_timestamp" })
  }

  async get_initial_quote_invested(pi: SpotPositionIdentifier_V3): Promise<BigNumber> {
    return this.get_sats_key(pi, { key_name: "initial_quote_invested" })
  }

  async get_edge(pi: SpotPositionIdentifier_V3): Promise<string> {
    return this.get_string_key_no_null(pi, { key_name: "edge" })
  }

  private async get_object_set_key(pi: SpotPositionIdentifier_V3, { key_name }: { key_name: string }) {
    let objects_as_strings: string[] = await this.redis.sMembers(this.name_to_key(pi, { name: key_name }))
    let objects = objects_as_strings.map((s) => JSON.parse(s))
    return objects
  }

  private async add_objects_to_set_key(
    pi: SpotPositionIdentifier_V3,
    { key_name, new_objects }: { key_name: string; new_objects: any[] }
  ): Promise<number> {
    let strings: string[] = new_objects.map((o) => JSON.stringify(o, Object.keys(o).sort()))
    let num_added = await this.redis.sAdd(this.name_to_key(pi, { name: key_name }), strings)
    return num_added
  }

  async add_orders(pi: SpotPositionIdentifier_V3, orders: GenericOrderData[]): Promise<number> {
    return this.add_objects_to_set_key(pi, { key_name: "orders", new_objects: orders })
  }

  async get_orders(pi: SpotPositionIdentifier_V3): Promise<GenericOrderData[]> {
    return this.get_object_set_key(pi, { key_name: "orders" })
  }

  async describe_position(pi: SpotPositionIdentifier_V3): Promise<SpotPositionObject> {
    let position_size,
      initial_entry_price,
      initial_entry_position_size,
      initial_entry_quote_asset,
      initial_quote_invested,
      initial_entry_timestamp,
      orders,
      edge,
      stop_order_id

    position_size = await this.get_position_size(pi)
    initial_entry_position_size = await this.get_initial_entry_position_size(pi)
    initial_entry_quote_asset = await this.get_initial_entry_quote_asset(pi)
    initial_entry_timestamp = await this.get_initial_entry_timestamp(pi)
    orders = await this.get_orders(pi)
    edge = (await this.get_edge(pi)) as AuthorisedEdgeType

    try {
      initial_entry_price = await this.get_initial_entry_price(pi)
    } catch (e) {
      /* nop */
    }

    try {
      initial_quote_invested = await this.get_initial_quote_invested(pi)
    } catch (e) {
      /* nop */
    }

    try {
      stop_order_id = await this.get_stop_order(pi)
    } catch (e) {
      /* nop */
    }

    let res = {
      object_type: "SpotPositionObject",
      position_size,
      initial_entry_price,
      initial_entry_position_size,
      initial_entry_quote_asset,
      initial_quote_invested,
      initial_entry_timestamp,
      orders,
      edge,
      stop_order_id,
    }

    // this.logger.info(JSON.stringify(res))

    return res
  }

  async create_new_position(pi: SpotPositionIdentifier_V3, spid: SpotPositionInitialisationData) {
    let {
      position_size,
      initial_entry_price,
      initial_quote_invested,
      initial_entry_quote_asset,
      initial_entry_timestamp,
      orders,
      edge,
    } = spid

    try {
      assert(initial_quote_invested.isPositive())
      let p_orders = this.add_orders(pi, orders)
      let p_mset = this.redis.mSet([
        this.name_to_key(pi, { name: "initial_entry_timestamp" }),
        initial_entry_timestamp.toString(),
        this.name_to_key(pi, { name: "initial_entry_position_size" }),
        to_sats(position_size.toFixed()),
        this.name_to_key(pi, { name: "position_size" }),
        to_sats(position_size.toFixed()),
        this.name_to_key(pi, { name: "initial_quote_invested" }),
        to_sats(initial_quote_invested.toFixed()),
        this.name_to_key(pi, { name: "initial_entry_price" }),
        to_sats(initial_entry_price.toFixed()),
        this.name_to_key(pi, { name: "initial_entry_quote_asset" }),
        initial_entry_quote_asset,
        this.name_to_key(pi, { name: "edge" }),
        edge,
      ])
      await Promise.all([p_orders, p_mset])
    } catch (err) {
      console.error(err)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.base_asset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(err)
      })
      throw err
    }
  }

  async _patch_initial_entry_quote_asset(pi: SpotPositionIdentifier_V3, { initial_entry_quote_asset }: any) {
    try {
      await this.redis.set(this.name_to_key(pi, { name: "initial_entry_quote_asset" }), initial_entry_quote_asset)
    } catch (err) {
      console.error(err)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.base_asset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        Sentry.captureException(err)
      })
      throw err
    }
  }

  async _patch_initial_entry_timestamp(pi: SpotPositionIdentifier_V3, { initial_entry_timestamp }: any) {
    try {
      await this.redis.set(this.name_to_key(pi, { name: "initial_entry_timestamp" }), initial_entry_timestamp)
    } catch (err) {
      console.error(err)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.base_asset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        Sentry.captureException(err)
      })
      throw err
    }
  }

  async adjust_position_size_by(
    pi: SpotPositionIdentifier_V3,
    { base_change }: { base_change: BigNumber }
  ): Promise<void> {
    try {
      let before = await this.get_position_size(pi)
      let key = this.name_to_key(pi, { name: "position_size" })
      await this.redis.incrBy(key, Number(to_sats(base_change.toFixed())))
      this.logger.debug(`adjust_position_size_by before: ${before} after: ${await this.get_position_size(pi)}`)
    } catch (err) {
      console.error(err)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.base_asset)
        scope.setTag("exchange", pi.exchange_identifier.exchange)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(err)
      })
      throw err
    }
  }

  async set_stop_order(pi: SpotPositionIdentifier_V3, order_id: OrderId) {
    return this.set_string_key(pi, { key_name: "stop_order_id" }, order_id.toString())
  }

  async get_stop_order(pi: SpotPositionIdentifier_V3): Promise<OrderId | undefined> {
    try {
      let foo = await this.get_string_key(pi, { key_name: "stop_order_id", null_allowed: true })
      return foo || undefined
    } catch (err) {
      return
    }
  }

  async set_stop_price(pi: SpotPositionIdentifier_V3, stop_price: BigNumber) {
    return this.set_string_key(pi, { key_name: "stop_order_price" }, stop_price.toString())
  }

  async get_stop_price(pi: SpotPositionIdentifier_V3): Promise<BigNumber | undefined> {
    try {
      let foo = await this.get_string_key(pi, { key_name: "stop_order_price", null_allowed: true })
      return foo ? new BigNumber(foo) : undefined
    } catch (err) {
      return
    }
  }

  async set_oco_order(pi: SpotPositionIdentifier_V3, order_id: OrderId) {
    return this.set_string_key(pi, { key_name: "oco_order_id" }, order_id.toString())
  }

  async get_oco_order(pi: SpotPositionIdentifier_V3): Promise<OrderId | undefined> {
    return (await this.get_string_key(pi, { key_name: "oco_order_id", null_allowed: true })) || undefined
  }

  async delete_position(pi: SpotPositionIdentifier_V3) {
    try {
      let keys = await this.redis.keys(`${this.prefix(pi)}:*`)
      await this.redis.del(keys)
    } catch (err) {
      console.error(err)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", pi.base_asset)
        scope.setTag("exchange", pi.exchange_identifier?.exchange)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(err)
      })
      throw err
    }
  }

  async open_positions(): Promise<SpotPositionIdentifier_V3[]> {
    const keys: string[] = await this.redis.keys(`${key_base}:*:sats_position_size`)
    this.logger.debug(`Loaded ${keys.length} matching keys from redis`)
    return keys.map((key: string) => {
      //`${key_base}:spot:${exchange}:${account}:${base_asset}:${pi.edge}`
      let tuple = key.match(/:spot:([^:]+):([^:]+):([^:]+):([^:]+):sats_position_size/)
      if (!tuple) throw new Error(`Key '${key} did not match regexp`)
      let pi: SpotPositionIdentifier_V3 = {
        exchange_identifier: { exchange: tuple[1], version: 4, exchange_type: "spot" },
        base_asset: tuple[3],
        edge: tuple[4] as AuthorisedEdgeType,
      }
      return pi
    })
  }
}
