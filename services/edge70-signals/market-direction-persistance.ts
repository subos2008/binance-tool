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
    edge_parameters_slug, // make this need explicit, if we change the num candles that's a new namespace
  }: {
    logger: ServiceLogger
    prefix: string
    redis: RedisClientType
    edge_parameters_slug: string
  }) {
    this.logger = logger
    this.prefix = `${prefix}:${edge_parameters_slug}`
    this.redis = redis
  }

  private _market_to_key(base_asset: string): string {
    return `${this.prefix}:signal_direction:${base_asset.toUpperCase()}`
  }

  async set_direction(base_asset: string, direction: Direction): Promise<Direction | null> {
    let previous_direction = await this.get_direction(base_asset)
    if (previous_direction === null) {
      this.logger.info(`Initialising direction for ${base_asset} to ${direction}`)
    } else if (previous_direction !== direction) {
      this.logger.info(`Direction change to ${direction} for ${base_asset}`)
    }

    this.logger.event(
      { level: "error" },
      { object_type: "TODO", msg: `verify expiry time for direction keys is working correctly` }
    )

    /* Always call set() as we will have expiry set on the keys so they disappear if a candle is missed */
    // EX is in seconds, we set 1 day plus an hours grace
    await this.redis.set(this._market_to_key(base_asset), direction, { "EX": 60 * 60 * 25 })

    return previous_direction
  }

  async get_direction(base_asset: string): Promise<Direction | null> {
    let direction = await this.redis.get(this._market_to_key(base_asset))
    return direction as Direction
  }
}
