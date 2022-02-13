import { RedisClient } from "redis"
import { AuthorisedEdgeType, check_edge } from "../../abstractions/position-identifier"
import { Logger } from "../../../../interfaces/logger"
import { strict as assert } from "assert"
import { promisify } from "util"
import {
  ExchangeIdentifier_V3,
  exchange_identifier_to_redis_key_snippet,
} from "../../../../events/shared/exchange-identifier"
import { OrderContextPersistence } from "../interface/order-context-persistence"
import { OrderContext_V1 } from "../../exchanges/interfaces/spot-execution-engine"

type OrderId = string

export class RedisOrderContextPersistance implements OrderContextPersistence {
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

  async set_order_context_for_order(args: {
    exchange_identifier: ExchangeIdentifier_V3
    order_id: OrderId
    order_context: OrderContext_V1
  }): Promise<void> {
    let json = JSON.stringify(args.order_context)
    await this.setAsync(this._key(args.exchange_identifier, args.order_id), json)
  }

  async get_order_context_for_order(args: {
    exchange_identifier: ExchangeIdentifier_V3
    order_id: OrderId
  }): Promise<OrderContext_V1> {
    let { order_id, exchange_identifier } = args

    let json = await this.getAsync(this._key(exchange_identifier, order_id))
    if (!json) throw new Error(`No OrderContext found for order ${order_id}`)

    let order_context: OrderContext_V1 = JSON.parse(json)
    order_context.edge = check_edge(order_context.edge)
    
    return order_context
  }
}
