import BigNumber from "bignumber.js"
import { RedisClientType } from "redis-v4"
import { HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { SpotPositionClosedEvent_V1 } from "../../classes/spot/abstractions/spot-position-publisher"
import { Logger } from "../../interfaces/logger"
import { get_redis_client } from "../../lib/redis-v4"
import { DateTime } from "luxon"

type TradeResult = "win" | "loss" | "unknown"

export class RedisEdgePerformancePersistence {
  redis: RedisClientType
  logger: Logger
  health_and_readiness: HealthAndReadinessSubsystem

  constructor(args: { logger: Logger; health_and_readiness: HealthAndReadinessSubsystem }) {
    this.logger = args.logger
    this.health_and_readiness = args.health_and_readiness
    this.redis = get_redis_client(this.logger, this.health_and_readiness)
  }

  async connect() {
    await this.redis.connect()
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

  async ingest_event(event: SpotPositionClosedEvent_V1) {
    let { edge, percentage_quote_change: percentage_quote_change_string, exit_signal_timestamp_ms } = event

    let percentage_quote_change: BigNumber | undefined = percentage_quote_change_string
      ? new BigNumber(percentage_quote_change_string)
      : undefined

    let dt = exit_signal_timestamp_ms ? DateTime.fromMillis(exit_signal_timestamp_ms).toUTC() : DateTime.utc()

    let result: TradeResult
    if (!percentage_quote_change) {
      result = "unknown"
    } else {
      result = percentage_quote_change.isGreaterThan(0) ? "win" : "loss"
    }

    await Promise.all([
      this.update_counts_for_key(this.all_time_results_counts_hash_key(edge), result),
      this.update_counts_for_key(this.daily_results_counts_hash_key(edge, dt), result),
      this.update_counts_for_key(this.monthly_results_counts_hash_key(edge, dt), result),
    ])
  }
}
