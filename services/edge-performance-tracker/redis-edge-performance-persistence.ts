import BigNumber from "bignumber.js"
import { RedisClientType } from "redis-v4"
import { SpotPositionClosedEvent_V1 } from "../../classes/spot/abstractions/spot-position-callbacks"
import { Logger } from "../../interfaces/logger"
import { DateTime } from "luxon"
import Sentry from "../../lib/sentry"

type TradeResult = "win" | "loss" | "unknown"

export class RedisEdgePerformancePersistence {
  redis: RedisClientType
  logger: Logger

  constructor(args: { logger: Logger; redis: RedisClientType }) {
    this.logger = args.logger
    this.redis = args.redis
  }

  private async results(key: string) {
    let foo = await this.redis.HGETALL(key)
    console.info(JSON.stringify({ object_type: "EdgePerformanceCounts", hgetall: foo }))
    return foo
  }

  async all_time_results(edge: string) {
    let res = await this.results(this.all_time_results_counts_hash_key(edge))
    console.info(JSON.stringify({ object_type: "EdgePerformanceCounts", timeslice: "all-time", ...res }))
    return res
  }

  async monthly_results(edge: string) {
    let res = await this.results(this.monthly_results_counts_hash_key(edge, DateTime.now()))
    console.info(JSON.stringify({ object_type: "EdgePerformanceCounts", timeslice: "monthly", ...res }))
    return res
  }

  async daily_results(edge: string) {
    let res = await this.results(this.daily_results_counts_hash_key(edge, DateTime.now()))
    console.info(JSON.stringify({ object_type: "EdgePerformanceCounts", timeslice: "daily", ...res }))
    return res
  }

  private all_time_results_counts_hash_key(edge: string) {
    return `edge-performance:v1:${edge}:all-time:results-counts-hash`
  }

  private daily_results_counts_hash_key(edge: string, dt: DateTime): string {
    dt = dt.toUTC()
    let timeslice = `${dt.year}-${dt.month}-${dt.day}`
    return `edge-performance:v1:${edge}:daily:${timeslice}:results-counts-hash`
  }

  private monthly_results_counts_hash_key(edge: string, dt: DateTime): string {
    dt = dt.toUTC()
    let timeslice = `${dt.year}-${dt.month}`
    return `edge-performance:v1:${edge}:monthly:${timeslice}:results-counts-hash`
  }

  private async update_counts_for_key(key: string, result: TradeResult) {
    switch (result) {
      case "win":
        this.redis.HINCRBY(key, `wins`, 1)
        break
      case "loss":
        this.redis.HINCRBY(key, `losses`, 1)
        break
      case "unknown":
        this.redis.HINCRBY(key, `unknown`, 1)
        break
    }
  }

  private async update_percentages_for_key(key: string, percentage_quote_change: number) {
    this.redis.HINCRBYFLOAT(key, "percentage_quote_change", percentage_quote_change)
  }
  private async update_abs_quote_change_for_key(key: string, delta: number) {
    this.redis.HINCRBYFLOAT(key, "abs_quote_change", delta)
  }

  async ingest_event(event: SpotPositionClosedEvent_V1) {
    let {
      edge,
      percentage_quote_change: percentage_quote_change_string, // actually bro this is a number...
      exit_signal_timestamp_ms,
      abs_quote_change,
    } = event


    let percentage_quote_change: BigNumber | undefined = percentage_quote_change_string
      ? new BigNumber(percentage_quote_change_string.toString())
      : undefined

    let dt = exit_signal_timestamp_ms ? DateTime.fromMillis(exit_signal_timestamp_ms).toUTC() : DateTime.utc()

    let result: TradeResult
    if (!percentage_quote_change) {
      result = "unknown"
    } else {
      result = percentage_quote_change.isGreaterThan(0) ? "win" : "loss"
    }

    try {
      await Promise.all([
        this.update_counts_for_key(this.all_time_results_counts_hash_key(edge), result),
        this.update_counts_for_key(this.daily_results_counts_hash_key(edge, dt), result),
        this.update_counts_for_key(this.monthly_results_counts_hash_key(edge, dt), result),
      ])
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }

    try {
      if (percentage_quote_change_string) {
        let delta: number = Number(percentage_quote_change_string)
        await Promise.all([
          this.update_percentages_for_key(this.all_time_results_counts_hash_key(edge), delta),
          this.update_percentages_for_key(this.daily_results_counts_hash_key(edge, dt), delta),
          this.update_percentages_for_key(this.monthly_results_counts_hash_key(edge, dt), delta),
        ])
      }
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }

    try {
      if (abs_quote_change) {
        let delta: number = Number(abs_quote_change)
        await Promise.all([
          this.update_abs_quote_change_for_key(this.all_time_results_counts_hash_key(edge), delta),
          this.update_abs_quote_change_for_key(this.daily_results_counts_hash_key(edge, dt), delta),
          this.update_abs_quote_change_for_key(this.monthly_results_counts_hash_key(edge, dt), delta),
        ])
      }
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }
  }
}
