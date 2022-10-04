import { RedisClient } from "redis"
import { Logger } from "../../../interfaces/logger"
import { strict as assert } from "assert"
import { promisify } from "util"
import {
  ExchangeIdentifier_V3,
  exchange_identifier_to_redis_key_snippet,
} from "../../../events/shared/exchange-identifier"
import { OrderContextPersistence, OrderContextPersistence_V2 } from "../interface/order-context-persistence"
import { OrderContext_V1, OrderContext_V2 } from "../../../interfaces/orders/order-context"
import { ContextTags } from "../../../interfaces/send-message"

type OrderId = string

export class RedisOrderContextPersistence implements OrderContextPersistence, OrderContextPersistence_V2 {
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
    order_context: OrderContext_V2
  }): Promise<void> {
    let { order_id, exchange_identifier } = args
    let json = JSON.stringify(args.order_context)
    if (!order_id) {
      throw new Error(`null order_id in set_order_context_for_order: order_id: '${order_id}', context: ${json}`)
    }
    await this.setAsync(this._key(exchange_identifier, order_id), json)
  }

  async get_order_context_for_order(args: {
    exchange_identifier: ExchangeIdentifier_V3
    order_id: OrderId
  }): Promise<OrderContext_V1 | OrderContext_V2> {
    let { order_id, exchange_identifier } = args
    try {
      // I think there was a bug where this would happen a while ago
      if (!order_id) throw new Error(`null order_id in get_order_context_for_order: ${order_id}`)

      let json = await this.getAsync(this._key(exchange_identifier, order_id))
      if (!json) throw new Error(`No OrderContext found for order ${order_id}`)

      let order_context: OrderContext_V1 | OrderContext_V2 = JSON.parse(json)
      return order_context
    } catch (err) {
      let tags: ContextTags = { order_id }
      let obj = { object_type: "OrderContextNotFound", order_id }
      this.logger.event(tags, obj)
      throw err
    }
  }
}
