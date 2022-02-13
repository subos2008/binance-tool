import { RedisClient } from "redis"
import { AuthorisedEdgeType, check_edge } from "../spot/abstractions/position-identifier"
import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { promisify } from "util"
import {
  ExchangeIdentifier_V3,
  exchange_identifier_to_redis_key_snippet,
} from "../../events/shared/exchange-identifier"

type OrderId = string

export class OrderToEdgeMapper {
  logger: Logger
  redis: RedisClient
  getAsync: any
  setAsync: any

  constructor({ logger, redis }: { logger: Logger; redis: RedisClient }) {
    assert(logger)
    this.logger = logger
    assert(redis)
    this.redis = redis

    this.getAsync = promisify(this.redis.get).bind(this.redis)
    this.setAsync = promisify(this.redis.set).bind(this.redis)
  }

  private _key(exchange_identifier: ExchangeIdentifier_V3, order_id: OrderId): string {
    return `OrderToEdgeMapper:${exchange_identifier_to_redis_key_snippet(exchange_identifier)}:${order_id}`
  }

  async set_edge_for_order(
    exchange_identifier: ExchangeIdentifier_V3,
    order_id: OrderId,
    edge: AuthorisedEdgeType
  ) {
    await this.setAsync(this._key(exchange_identifier, order_id), edge)
  }

  async get_edge_for_order(
    exchange_identifier: ExchangeIdentifier_V3,
    order_id: OrderId
  ): Promise<AuthorisedEdgeType> {
    let edge = await this.getAsync(this._key(exchange_identifier, order_id))
    if (!edge) throw new Error(`No edge known for order ${order_id}`)
    return check_edge(edge)
  }
}
