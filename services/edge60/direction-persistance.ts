import { RedisClient } from "redis"
import { promisify } from "util"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { Logger } from "../../interfaces/logger"
import { get_redis_client, set_redis_logger } from "../../lib/redis"

export type Direction = "short" | "long" // Redis returns null for unset

export class DirectionPersistance {
  logger: Logger
  redis: RedisClient
  prefix: string
  setAsync: any
  getAsync: any

  constructor({ logger, prefix }: { logger: Logger; prefix: string }) {
    this.logger = logger
    set_redis_logger(logger)
    this.redis = get_redis_client()
    this.prefix = prefix
    this.setAsync = promisify(this.redis.set).bind(this.redis)
    this.getAsync = promisify(this.redis.get).bind(this.redis)
  }

  private _market_to_key(market: MarketIdentifier_V3): string {
    return `${this.prefix}/signal_direction/${market.symbol.toUpperCase()}`
  }

  async set_direction(market: MarketIdentifier_V3, direction: Direction) {
    this.setAsync(this._market_to_key(market), direction)
  }

  async get_direction(market: MarketIdentifier_V3): Promise<Direction | null> {
    return this.getAsync(this._market_to_key(market))
  }
}
