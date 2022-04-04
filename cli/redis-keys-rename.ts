#!./node_modules/.bin/ts-node

require("dotenv").config()

import { strict as assert } from "assert"
const { promisify } = require("util")

/** One off command to rename keys */

import { RedisClient } from "redis"

// These should be equivalent
let redis_regexp = "positions-v2:binance:default:*"
let regexp = new RegExp(`positions-v2:binance:default:(.*):(.*)`)

// Dangerous code in this file - do not execute
// process.exit(1)

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
    let subkey = res[2]
    if (!market) {
      console.log(key)
      throw new Error("no symbol")
    }
    return `positions-v3:spot:binance:default:${market}:undefined:${subkey}`
  }

  async run() {
    let nop = false
    let keys: string[] = await this.keys()
    for (const key of keys) {
      try {
        const direction: string = await this.getAsync(key)
        if (key.endsWith(":orders")) continue
        let new_key = this.translate_key(key)
        console.log(`${key} -> ${new_key}`)
        let new_key_value = await this.getAsync(new_key)
        if (nop) continue
        if (new_key_value) {
          this.delAsync(key)
          continue // don't overwrite keys that exist at the destination
        }
        await this.setAsync(new_key, direction)
        console.info(`Set ${new_key} to ${direction}`)
        // this.delAsync(key)
      } catch (err) {
        console.error(`Error processing key ${key}`)
        console.error(err)
      }
    }
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
