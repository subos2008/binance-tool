import { RedisClientType } from "redis-v4"
import { Logger } from "../../interfaces/logger"
import { SendMessageFunc } from "../../classes/send_message/publish"

export type Direction = "short" | "long" // Redis returns null for unset

export class DirectionPersistance {
  private logger: Logger
  private redis: RedisClientType
  private prefix: string

  constructor({
    logger,
    prefix,
    send_message,
    redis,
  }: {
    logger: Logger
    prefix: string
    send_message: SendMessageFunc
    redis: RedisClientType
  }) {
    this.logger = logger
    this.prefix = prefix
    this.redis = redis
  }

  private _market_to_key(symbol: string): string {
    return `${this.prefix}:signal_direction:${symbol.toUpperCase()}`
  }

  async set_direction(symbol: string, direction: Direction) {
    let previous_direction = await this.get_direction(symbol)
    if (previous_direction === null) {
      this.logger.info(`Initialising direction for ${symbol} to ${direction}`)
    } else if (previous_direction !== direction) {
      this.logger.info(`Direction change to ${direction} for ${symbol}`)
    }
    await this.redis.set(this._market_to_key(symbol), direction)
    return previous_direction
  }

  async get_direction(symbol: string): Promise<Direction | null> {
    let direction = await this.redis.get(this._market_to_key(symbol))
    return direction as Direction
  }
}
