import { RedisClientType } from "redis-v4"
import { PositionEntryArgs } from "./interfaces"

/**
 * the can_signal functions guard us from continual entry signals on every price
 * long or short of the donchien channel. We want to trigger once and then be silent
 */

export class RetriggerPrevention {
  private key_prefix: string
  private redis: RedisClientType

  constructor({ key_prefix, redis }: { key_prefix: string; redis: RedisClientType }) {
    this.key_prefix = key_prefix
    this.redis = redis
  }

  /**
   * Returns true if we are allowed to trigger at the same time setting Redis state
   * to prevent future triggering until the provided time
   */
  async atomic_trigger_check_and_prevent(args: PositionEntryArgs, expiry_timestamp: number): Promise<boolean> {
    let { symbol } = args
    let key = `${this.key_prefix}:${symbol}`
    let got_lock: boolean = await this.redis.SETNX(key, Date.now().toString())

    if (got_lock) {
      // expiry_timestamp is a unix timestamp in seconds
      let expiry_timestamp_seconds = expiry_timestamp / 1000
      console.log(`expireAt: ${expiry_timestamp_seconds}`)
      this.redis.expireAt(key, expiry_timestamp_seconds)
      console.info(
        JSON.stringify({
          symbol,
          edge: "edge61",
          object_type: "RetriggerPreventionLockResult",
          expiry_timestamp,
          got_lock,
        })
      )
    }
    return got_lock
  }
}
