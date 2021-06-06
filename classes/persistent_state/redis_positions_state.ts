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

// We store as integers in redis because it uses hardware for floating point calculations
function to_sats(input: string | BigNumber) {
  return new BigNumber(input).times("1e8").toFixed()
}

function from_sats(input: string | BigNumber) {
  return new BigNumber(input).dividedBy("1e8").toFixed()
}

const key_base = "positions-v2"
export class RedisPositionsState {
  logger: Logger
  redis: any
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
    let prefix = `${key_base}:${exchange}:${account}:${baseAsset}`
    switch (name) {
      case "position_size":
        return `${prefix}:sats_position_size`
      case "initial_entry_price":
        return `${prefix}:sats_initial_entry_price`
      case "netQuoteBalanceChange":
        return `${prefix}:sats_netQuoteBalanceChange`
      case "initial_quote_invested":
        return `${prefix}:sats_${name}`
      case "total_quote_invested":
        return `${prefix}:sats_${name}`
      case "total_quote_withdrawn":
        return `${prefix}:sats_${name}`
      default:
        throw new Error(`Unknown key name: ${name}`)
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
  }): Promise<BigNumber | undefined> {
    const key = this.name_to_key({ baseAsset, exchange, account, name: key_name })
    const sats_or_null = await this.getAsync(key)
    return sats_or_null ? new BigNumber(from_sats(sats_or_null)) : undefined
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

  async get_initial_entry_price({
    baseAsset,
    exchange,
    account,
  }: {
    baseAsset: string
    exchange: string
    account: string
  }): Promise<BigNumber | undefined> {
    return this.get_sats_key({
      baseAsset,
      exchange,
      account,
      key_name: "initial_entry_price",
    })
  }

  async get_netQuoteBalanceChange({
    baseAsset,
    exchange,
    account,
  }: {
    baseAsset: string
    exchange: string
    account: string
  }): Promise<BigNumber | undefined> {
    return this.get_sats_key({
      baseAsset,
      exchange,
      account,
      key_name: "netQuoteBalanceChange",
    })
  }

  async get_total_quote_invested({
    baseAsset,
    exchange,
    account,
  }: {
    baseAsset: string
    exchange: string
    account: string
  }): Promise<BigNumber | undefined> {
    return this.get_sats_key({
      baseAsset,
      exchange,
      account,
      key_name: "total_quote_invested",
    })
  }

  async get_total_quote_withdrawn({
    baseAsset,
    exchange,
    account,
  }: {
    baseAsset: string
    exchange: string
    account: string
  }): Promise<BigNumber | undefined> {
    return this.get_sats_key({
      baseAsset,
      exchange,
      account,
      key_name: "total_quote_withdrawn",
    })
  }

  async describe_position({ baseAsset, exchange_identifier }: PositionIdentifier): Promise<{
    position_size: BigNumber | undefined
    initial_entry_price: BigNumber | undefined
    netQuoteBalanceChange: BigNumber | undefined
    total_quote_invested: BigNumber | undefined
    total_quote_withdrawn: BigNumber | undefined
  }> {
    let id = {
      baseAsset,
      exchange: exchange_identifier.exchange,
      account: exchange_identifier.account,
    }
    return {
      position_size: await this.get_position_size(id),
      initial_entry_price: await this.get_initial_entry_price(id),
      netQuoteBalanceChange: await this.get_netQuoteBalanceChange(id),
      total_quote_invested: await this.get_total_quote_invested(id),
      total_quote_withdrawn: await this.get_total_quote_withdrawn(id),
    }
  }

  async create_new_position(
    { baseAsset, exchange, account }: { baseAsset: string; exchange: string; account: string },
    {
      position_size,
      initial_entry_price,
      quote_invested,
    }: {
      position_size: BigNumber
      initial_entry_price?: BigNumber
      quote_invested: BigNumber
    }
  ) {
    try {
      await this.msetAsync(
        this.name_to_key({ baseAsset, exchange, account, name: "position_size" }),
        to_sats(position_size.toFixed())
      )
      if (initial_entry_price)
        await this.msetAsync(
          this.name_to_key({
            baseAsset,
            exchange,
            account,
            name: "initial_entry_price",
          }),
          to_sats(initial_entry_price?.toFixed())
        )
      assert(quote_invested.isPositive())
      await this.msetAsync(
        this.name_to_key({ baseAsset, exchange, account, name: "netQuoteBalanceChange" }),
        to_sats(quote_invested?.negated().toFixed()),
        this.name_to_key({ baseAsset, exchange, account, name: "initial_quote_invested" }),
        to_sats(quote_invested?.toFixed()),
        this.name_to_key({ baseAsset, exchange, account, name: "total_quote_invested" }),
        to_sats(quote_invested?.toFixed()),
        this.name_to_key({ baseAsset, exchange, account, name: "total_quote_withdrawn" }),
        to_sats(new BigNumber(0))
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

  async adjust_position_size_by(
    { baseAsset, exchange, account }: { baseAsset: string; exchange: string; account: string },
    {
      base_change,
      // quoteAsset,
      // quote_change,
    }: { base_change: BigNumber; quote_change: BigNumber; quoteAsset: string }
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

  async close_position({
    baseAsset,
    exchange,
    account,
  }: {
    baseAsset: string
    exchange: string
    account: string
  }) {
    try {
      await this.delAsync(this.name_to_key({ baseAsset, exchange, account, name: "position_size" }))
      await this.delAsync(this.name_to_key({ baseAsset, exchange, account, name: "initial_entry_price" }))
      await this.delAsync(this.name_to_key({ baseAsset, exchange, account, name: "netQuoteBalanceChange" }))
      await this.delAsync(this.name_to_key({ baseAsset, exchange, account, name: "initial_quote_invested" }))
      await this.delAsync(this.name_to_key({ baseAsset, exchange, account, name: "total_quote_invested" }))
      await this.delAsync(this.name_to_key({ baseAsset, exchange, account, name: "total_quote_withdrawn" }))
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

  // depricated
  async open_position_ids() {
    const keys = await this.keysAsync(`${key_base}:*:sats_position_size`)
    return keys.map((key: any) => {
      let tuple = key.match(/:([^:]+):([^:]+):([^:]+):sats_position_size/)
      return { exchange: tuple[1], account: tuple[2], baseAsset: tuple[3] }
    })
  }
}
