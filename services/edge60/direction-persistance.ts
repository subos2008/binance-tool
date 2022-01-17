import { RedisClient } from "redis"
import { promisify } from "util"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { Logger } from "../../interfaces/logger"
import { get_redis_client, set_redis_logger } from "../../lib/redis"

export type Direction = "short" | "long" // Redis returns null for unset

export class DirectionPersistance {
  private logger: Logger
  private redis: RedisClient
  private prefix: string
  private setAsync: any
  private getAsync: any

  constructor({ logger, prefix }: { logger: Logger; prefix: string }) {
    this.logger = logger
    set_redis_logger(logger)
    this.redis = get_redis_client()
    this.prefix = prefix
    this.setAsync = promisify(this.redis.set).bind(this.redis)
    this.getAsync = promisify(this.redis.get).bind(this.redis)
  }

  private _market_to_key(symbol: string): string {
    return `${this.prefix}/signal_direction/${symbol.toUpperCase()}`
  }

  async set_direction(symbol: string, direction: Direction) {
    this.logger.info(`Setting direction ${direction} for ${symbol}`)
    this.setAsync(this._market_to_key(symbol), direction)
  }

  async get_direction(symbol: string): Promise<Direction | null> {
    let direction = this.getAsync(this._market_to_key(symbol))
    this.logger.info(`Loaded direction ${direction} for ${symbol}`)
    return direction
  }
}
