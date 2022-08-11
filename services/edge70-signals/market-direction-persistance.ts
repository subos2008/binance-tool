import { RedisClientType } from "redis-v4"
import { ServiceLogger } from "../../interfaces/logger"
import { Direction, DirectionPersistence } from "./interfaces/direction-persistance"

export class DirectionPersistenceRedis implements DirectionPersistence {
  private logger: ServiceLogger
  private redis: RedisClientType
  private prefix: string

  constructor({
    logger,
    prefix,
    redis,
  }: {
    logger: ServiceLogger
    prefix: string
    redis: RedisClientType
  }) {
    this.logger = logger
    this.prefix = prefix
    this.redis = redis
  }

  private _market_to_key(base_asset: string): string {
    return `${this.prefix}:signal_direction:${base_asset.toUpperCase()}`
  }

  async set_direction(base_asset: string, direction: Direction) {
    let previous_direction = await this.get_direction(base_asset)
    if (previous_direction === null) {
      this.logger.info(`Initialising direction for ${base_asset} to ${direction}`)
    } else if (previous_direction !== direction) {
      this.logger.info(`Direction change to ${direction} for ${base_asset}`)
    }
    await this.redis.set(this._market_to_key(base_asset), direction)
    return previous_direction
  }

  async get_direction(base_asset: string): Promise<Direction | null> {
    let direction = await this.redis.get(this._market_to_key(base_asset))
    return direction as Direction
  }
}
