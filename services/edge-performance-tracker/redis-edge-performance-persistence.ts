import BigNumber from "bignumber.js"
import { RedisClientType } from "redis-v4"
import { HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { SpotPositionClosedEvent_V1 } from "../../classes/spot/abstractions/spot-position-publisher"
import { Logger } from "../../interfaces/logger"
import { get_redis_client } from "../../lib/redis-v4"

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

  async results(edge: string) {
    let key = this.results_counts_hash_key(edge)
    let foo = await this.redis.HGETALL(key)
    console.info(JSON.stringify({ object_type: "EdgePerformanceCounts", hgetall: foo }))
    return foo
  }

  private results_counts_hash_key(edge: string) {
    return `edge-performance:v1:${edge}:all-time:results-counts-hash`
  }

  async ingest_event(event: SpotPositionClosedEvent_V1) {
    let { edge, percentage_quote_change: percentage_quote_change_string } = event

    let percentage_quote_change: BigNumber | undefined = percentage_quote_change_string
      ? new BigNumber(percentage_quote_change_string)
      : undefined

    let result: "win" | "loss" | "unknown"
    if (!percentage_quote_change) {
      result = "unknown"
    } else {
      result = percentage_quote_change.isGreaterThan(0) ? "win" : "loss"
    }

    let key = this.results_counts_hash_key(edge)
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
}
