import { RedisClient } from "redis"
import { AuthorisedEdgeType } from "../../events/shared/position-identifier"
import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { promisify } from "util"

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

  private _key(order_id: OrderId): string {
    return `OrderToEdgeMapper:${order_id}`
  }

  async set_edge_for_order(order_id: OrderId, edge: AuthorisedEdgeType) {
    await this.setAsync(this._key(order_id), edge)
  }

  async get_edge_for_order(order_id: OrderId): Promise<AuthorisedEdgeType> {
    let edge = await this.getAsync(this._key(order_id))
    if (!edge) throw new Error(`No edge known for order ${order_id}`)
    return edge as AuthorisedEdgeType
  }
}
