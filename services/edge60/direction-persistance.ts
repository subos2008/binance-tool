import { RedisClient } from "redis"
import { promisify } from "util"
import { Logger } from "../../interfaces/logger"
import { get_redis_client, set_redis_logger } from "../../lib/redis"
import { SendMessageFunc } from "../../lib/telegram-v2"

export type Direction = "short" | "long" // Redis returns null for unset

export class DirectionPersistance {
  private logger: Logger
  private redis: RedisClient
  private prefix: string
  private setAsync: any
  private getAsync: any
  private send_message: SendMessageFunc

  constructor({
    logger,
    prefix,
    send_message,
  }: {
    logger: Logger
    prefix: string
    send_message: SendMessageFunc
  }) {
    this.logger = logger
    set_redis_logger(logger)
    this.redis = get_redis_client()
    this.prefix = prefix
    this.setAsync = promisify(this.redis.set).bind(this.redis)
    this.getAsync = promisify(this.redis.get).bind(this.redis)
    this.send_message = send_message
  }

  private _market_to_key(symbol: string): string {
    return `${this.prefix}/signal_direction/${symbol.toUpperCase()}`
  }

  async set_direction(symbol: string, direction: Direction) {
    this.logger.info(`Setting direction ${direction} for ${symbol}`)
    let previous_direction = await this.get_direction(symbol)
    if (previous_direction === null) {
      this.send_message(`Initialising edge60 direction for ${symbol} to ${direction}`)
    }
    await this.setAsync(this._market_to_key(symbol), direction)
  }

  async get_direction(symbol: string): Promise<Direction | null> {
    let direction = await this.getAsync(this._market_to_key(symbol))
    this.logger.info(`Loaded direction ${direction} for ${symbol}`)
    return direction
  }
}
