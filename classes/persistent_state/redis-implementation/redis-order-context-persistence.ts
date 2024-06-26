import { RedisClientType } from "redis-v4"
import { Logger } from "../../../interfaces/logger"
import { strict as assert } from "assert"
import {
  ExchangeIdentifier_V3,
  ExchangeIdentifier_V4,
  exchange_identifier_to_redis_key_snippet,
} from "../../../events/shared/exchange-identifier"
import { OrderContextPersistence, OrderContextPersistence_V2 } from "../interface/order-context-persistence"
import { OrderContext_V1, OrderContext_V2 } from "../../../interfaces/orders/order-context"
import { ContextTags } from "../../../interfaces/send-message"

type OrderId = string

export class RedisOrderContextPersistence implements OrderContextPersistence, OrderContextPersistence_V2 {
  logger: Logger
  redis: RedisClientType

  constructor({ logger, redis }: { logger: Logger; redis: RedisClientType }) {
    assert(logger)
    this.logger = logger
    assert(redis)
    this.redis = redis
  }

  private _key(exchange_identifier: ExchangeIdentifier_V4, order_id: OrderId): string {
    return `OrderToEdgeMapper:${exchange_identifier_to_redis_key_snippet(exchange_identifier)}:${order_id}`
  }

  async set_order_context_for_order(args: {
    exchange_identifier: ExchangeIdentifier_V4
    order_id: OrderId
    order_context: OrderContext_V2
  }): Promise<void> {
    let { order_id, exchange_identifier } = args
    let json = JSON.stringify(args.order_context)
    if (!order_id) {
      throw new Error(`null order_id in set_order_context_for_order: order_id: '${order_id}', context: ${json}`)
    }
    await this.redis.set(this._key(exchange_identifier, order_id), json)
  }

  async get_order_context_for_order(args: {
    exchange_identifier: ExchangeIdentifier_V4
    order_id: OrderId
  }): Promise<OrderContext_V1 | OrderContext_V2> {
    let { order_id, exchange_identifier } = args
    try {
      // I think there was a bug where this would happen a while ago
      if (!order_id) throw new Error(`null order_id in get_order_context_for_order: ${order_id}`)

      let json = await this.redis.get(this._key(exchange_identifier, order_id))
      if (!json) throw new Error(`No OrderContext found for order ${order_id}`)

      let order_context: OrderContext_V1 | OrderContext_V2 = JSON.parse(json)
      return order_context
    } catch (err) {
      let tags: ContextTags = { order_id }
      let obj = { object_type: "OrderContextNotFound", order_id }
      this.logger.event({ ...tags, level: "warn" }, obj)
      throw err
    }
  }
}
