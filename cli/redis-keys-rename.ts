#!./node_modules/.bin/ts-node

require("dotenv").config()

import { strict as assert } from "assert"
const { promisify } = require("util")

/** One off command to rename keys */

import { RedisClient } from "redis"

//     edge60/spot/binance/signal_direction/XMRBUSD

// These should be equivalent
let redis_regexp = "edge60:spot:binance:signal_direction:usd_quote:*"
let regexp = new RegExp(`edge60:spot:binance:signal_direction:usd_quote:(.*)`)

export class Foo {
  redis: RedisClient
  getAsync: any
  setAsync: any
  mgetAsync: any
  keysAsync: any
  delAsync: any

  constructor({ redis }: { redis: RedisClient }) {
    assert(redis)
    this.redis = redis

    this.setAsync = promisify(this.redis.set).bind(this.redis)
    this.getAsync = promisify(this.redis.get).bind(this.redis)
    this.mgetAsync = promisify(this.redis.mget).bind(this.redis)
    this.keysAsync = promisify(this.redis.keys).bind(this.redis)
    this.delAsync = promisify(this.redis.del).bind(this.redis)
  }

  async keys() {
    const keys = await this.keysAsync(redis_regexp)
    return keys
  }

  translate_key(key: string): string {
    // remove USDT/BUSD, swap / for :, remove double slash?
    // key = key.replace(":signal_direction:usd_quote:", ":usd_quote:signal_direction:")
    let res = key.match(regexp)
    // console.log(key)
    // console.log(res)
    if (!res) {
      console.log(key)
      console.log(res)
      throw new Error("failed to match")
    }
    let market = res[1]
    if (!market) {
      console.log(key)
      throw new Error("no symbol")
    }
    market = market.replace(/USDT$/, "").replace(/BUSD$/, "")
    market = market.replace("/", ":")
    return `edge60:spot:binance:usd_quote:signal_direction:${market}`
  }

  async run() {
    let keys = await this.keys()
    const result: string[] = []
    for (const key of keys) {
      const direction: string = await this.getAsync(key)
      let new_key = this.translate_key(key)
      console.log(`${key} -> ${new_key}`)
      let new_key_value = await this.getAsync(new_key)
      if (new_key_value) continue // don't overwrite keys that exist at the destination
      this.setAsync(new_key, direction)
      console.info(`Set ${new_key} to ${direction}`)
      this.delAsync(key)
    }
    return result
  }
}

import { Logger } from "../interfaces/logger"
const LoggerClass = require("../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { get_redis_client, set_redis_logger } from "../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()

let foo = new Foo({ redis })
foo.run()
