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

// We store as integers in redis because it uses hardware for floating point calculations
function to_sats(input: string | BigNumber) {
  return new BigNumber(input).times("1e8").toFixed()
}

function from_sats(input: string | BigNumber) {
  return new BigNumber(input).dividedBy("1e8").toFixed()
}

const key_base = "positions-v2"

type id = {
  baseAsset: string
  exchange: string
  account: string
}

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
  }

  private prefix({ baseAsset, exchange, account }: { baseAsset: string; exchange: string; account: string }) {
    return `${key_base}:${exchange}:${account}:${baseAsset}`
  }

  name_to_key({
    baseAsset,
    name,
    exchange,
    account,
  }: {
    baseAsset: string
    name: string
    exchange: string
    account: string
  }) {
    let prefix = this.prefix({ baseAsset, exchange, account })
    switch (name) {
      case "position_size":
      case "initial_entry_price":
      case "netQuoteBalanceChange":
      case "initial_quote_invested":
      case "total_quote_invested":
      case "total_quote_withdrawn":
        return `${prefix}:sats_${name}`
      default:
        return `${prefix}:${name}`
    }
  }

  async set_position_size({
    baseAsset,
    position_size,
    exchange,
    account,
  }: {
    baseAsset: string
    position_size: BigNumber
    exchange: string
    account: string
  }): Promise<void> {
    try {
      await this.msetAsync(
        this.name_to_key({ baseAsset, exchange, account, name: "position_size" }),
        to_sats(position_size.toFixed())
      )
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", baseAsset)
        scope.setTag("exchange", exchange)
        scope.setTag("account", account)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async get_sats_key({
    baseAsset,
    exchange,
    account,
    key_name,
  }: {
    baseAsset: string
    exchange: string
    account: string
    key_name: string
  }): Promise<BigNumber> {
    const key = this.name_to_key({ baseAsset, exchange, account, name: key_name })
    const sats_or_null = await this.getAsync(key)
    if (!sats_or_null) throw new Error(`${key} missing from position`)
    return new BigNumber(from_sats(sats_or_null))
  }

  async get_string_key(args: id, { key_name }: { key_name: string }): Promise<string> {
    const key = this.name_to_key({ ...args, name: key_name })
    const value = await this.getAsync(key)
    if (!value) throw new Error(`${key} missing from position`)
    return value
  }

  async get_number_key(args: id, { key_name }: { key_name: string }): Promise<number | undefined> {
    const key = this.name_to_key({ ...args, name: key_name })
    const value = await this.getAsync(key)
    if (!value) throw new Error(`${key} missing from position`)
    return Number(value)
  }

  async get_position_size({
    baseAsset,
    exchange,
    account,
  }: {
    baseAsset: string
    exchange: string
    account: string
  }): Promise<BigNumber> {
    return (
      (await this.get_sats_key({
        baseAsset,
        exchange,
        account,
        key_name: "position_size",
      })) || new BigNumber(0)
    )
  }

  async get_initial_entry_price({ baseAsset, exchange, account }: id): Promise<BigNumber | undefined> {
    return this.get_sats_key({
      baseAsset,
      exchange,
      account,
      key_name: "initial_entry_price",
    })
  }

  async get_initial_entry_quote_asset(args: id): Promise<string | undefined> {
    return this.get_string_key(args, { key_name: "initial_entry_quote_asset" })
  }

  async get_initial_entry_timestamp(args: id): Promise<number | undefined> {
    return this.get_number_key(args, {key_name: "initial_entry_timestamp" })
  }

  async get_netQuoteBalanceChange(args: id): Promise<BigNumber | undefined> {
    return this.get_sats_key({ ...args, key_name: "netQuoteBalanceChange" })
  }

  async get_initial_quote_invested(args: id): Promise<BigNumber | undefined> {
    return this.get_sats_key({ ...args, key_name: "initial_quote_invested" })
  }

  async describe_position({ baseAsset, exchange_identifier }: PositionIdentifier): Promise<PositionObject> {
    let id = {
      baseAsset,
      exchange: exchange_identifier.exchange,
      account: exchange_identifier.account,
    }
    let initial_entry_price = await this.get_initial_entry_price(id)
    let initial_entry_quote_asset = await this.get_initial_entry_quote_asset(id)
    let initial_entry_timestamp = await this.get_initial_entry_timestamp(id)
    let initial_quote_invested = await this.get_initial_quote_invested(id)

    if (!initial_entry_price) throw new Error(`initial_entry_price missing from position`)
    if (!initial_entry_quote_asset) throw new Error(`initial_entry_quote_asset missing from position`)
    if (!initial_entry_timestamp) throw new Error(`initial_entry_timestamp missing from position`)
    if (!initial_quote_invested) throw new Error(`initial_quote_invested missing from position`)

    return {
      position_size: await this.get_position_size(id),
      initial_entry_price,
      initial_entry_quote_asset,
      initial_quote_invested,
      initial_entry_timestamp,
    }
  }

  async create_new_position(
    args: id,
    {
      position_size,
      initial_entry_price,
      initial_quote_invested,
      initial_entry_quote_asset,
      initial_entry_timestamp,
    }: PositionObject
  ) {
    try {
      assert(initial_quote_invested.isPositive())
      await this.msetAsync(
        this.name_to_key({ ...args, name: "initial_entry_timestamp" }),
        initial_entry_timestamp,
        this.name_to_key({ ...args, name: "position_size" }),
        to_sats(position_size.toFixed()),
        this.name_to_key({ ...args, name: "initial_quote_invested" }),
        to_sats(initial_quote_invested?.toFixed()),
        this.name_to_key({ ...args, name: "initial_entry_price" }),
        to_sats(initial_entry_price?.toFixed()),
        this.name_to_key({ ...args, name: "initial_entry_quote_asset" }),
        initial_entry_quote_asset
      )
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", args.baseAsset)
        scope.setTag("exchange", args.exchange)
        scope.setTag("account", args.account)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async _patch_initial_entry_quote_asset(args: id, { initial_entry_quote_asset }: any) {
    try {
      await this.msetAsync(
        this.name_to_key({ ...args, name: "initial_entry_quote_asset" }),
        initial_entry_quote_asset
      )
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", args.baseAsset)
        scope.setTag("exchange", args.exchange)
        scope.setTag("account", args.account)
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async _patch_initial_entry_timestamp(args: id, { initial_entry_timestamp }: any) {
    try {
      await this.msetAsync(this.name_to_key({ ...args, name: "initial_entry_timestamp" }), initial_entry_timestamp)
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", args.baseAsset)
        scope.setTag("exchange", args.exchange)
        scope.setTag("account", args.account)
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async adjust_position_size_by(
    { baseAsset, exchange, account }: { baseAsset: string; exchange: string; account: string },
    {
      base_change,
    }: // quoteAsset,
    // quote_change,
    { base_change: BigNumber }
  ): Promise<void> {
    // TODO: store which quote asset
    // TODO: with timeStamp. List quoteAsset, time, quanitity, usd_equiv, btc_equiv?
    try {
      await this.incrbyAsync(
        this.name_to_key({ baseAsset, exchange, account, name: "position_size" }),
        to_sats(base_change.toFixed())
      )
      // await this.incrbyAsync(
      //   this.name_to_key({ baseAsset, exchange, account, name: "netQuoteBalanceChange" }),
      //   to_sats(quote_change.toFixed())
      // )
      // if (quote_change.isPositive()) {
      //   await this.incrbyAsync(
      //     this.name_to_key({ baseAsset, exchange, account, name: "total_quote_invested" }),
      //     to_sats(quote_change.toFixed())
      //   )
      // }
      // if (quote_change.isNegative()) {
      //   // Decr by a negative value
      //   await this.decrbyAsync(
      //     this.name_to_key({ baseAsset, exchange, account, name: "total_quote_withdrawn" }),
      //     to_sats(quote_change.toFixed())
      //   )
      // }
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", baseAsset)
        scope.setTag("exchange", exchange)
        scope.setTag("account", account)
        // scope.setTag("redis.connected", this.redis.connected.toString());
        Sentry.captureException(error)
      })
      throw error
    }
  }

  async close_position(args: id) {
    try {
      let keys = await this.keysAsync(`${this.prefix(args)}:*`)
      for (let key of keys) {
        await this.delAsync(key)
      }
    } catch (error) {
      console.error(error)
      Sentry.withScope(function (scope) {
        scope.setTag("baseAsset", args.baseAsset)
        scope.setTag("exchange", args.exchange)
        scope.setTag("account", args.account)
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
