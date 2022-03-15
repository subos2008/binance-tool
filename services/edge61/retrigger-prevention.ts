import { promisify } from "node:util"
import { RedisClient } from "redis"
import { PositionEntryArgs } from "./interfaces"

/**
 * the can_signal functions guard us from continual entry signals on every price
 * long or short of the donchien channel. We want to trigger once and then be silent
 */

export class RetriggerPrevention {
  private key_prefix: string
  private redis: RedisClient
  private asyncSetNx: any

  constructor({ key_prefix, redis }: { key_prefix: string; redis: RedisClient }) {
    this.key_prefix = key_prefix
    this.redis = redis
    this.asyncSetNx = promisify(this.redis.setnx).bind(this.redis)
  }

  /**
   * Returns true if we are allowed to trigger at the same time setting Redis state
   * to prevent future triggering until the provided time
   */
  async atomic_trigger_check_and_prevent(
    args: PositionEntryArgs,
    expiry_timestamp_seconds: number
  ): Promise<boolean> {
    let { symbol } = args
    let key = `${this.key_prefix}:${symbol}`
    let got_lock = await this.asyncSetNx(key, Date.now().toString())
    // expiry_timestamp is a unix timestamp in seconds
    this.redis.expireat(key, expiry_timestamp_seconds)
    console.info(
      JSON.stringify({
        symbol,
        edge: "edge61",
        object_type: "GotRetriggerPreventionLock",
        msg: `atomic_trigger_check_and_prevent got lock, expires at ${expiry_timestamp_seconds} seconds timestamp`,
      })
    )
    return got_lock ? true : false
  }
}
