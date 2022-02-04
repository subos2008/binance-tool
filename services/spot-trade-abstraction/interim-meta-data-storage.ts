import { strict as assert } from "assert"
const { promisify } = require("util")

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { RedisClient } from "redis"
import { InterimSpotPositionsMetaDataPersistantStorage } from "./trade-abstraction-service"
import { SpotPositionIdentifier_V3 } from "../../classes/spot/abstractions/position-identifier"

export class RedisInterimSpotPositionsMetaDataPersistantStorage
  implements InterimSpotPositionsMetaDataPersistantStorage
{
  logger: Logger
  redis: RedisClient
  setAsync: any
  getAsync: any

  constructor({ logger, redis }: { logger: Logger; redis: RedisClient }) {
    this.logger = logger
    assert(redis)
    this.redis = redis

    this.setAsync = promisify(this.redis.set).bind(this.redis)
    this.getAsync = promisify(this.redis.get).bind(this.redis)
  }

  private _key(pi: SpotPositionIdentifier_V3) {
    return `RedisInterimSpotPositionsMetaDataPersistantStorage:${pi.exchange_identifier.exchange}:${pi.exchange_identifier.type}:${pi.base_asset}:stop_order_id`
  }
  async set_stop_order_id(spot_position_identifier: SpotPositionIdentifier_V3, order_id: string): Promise<void> {
    this.setAsync(this._key(spot_position_identifier), order_id)
  }

  // null means no stop (known)
  async get_stop_order_id(spot_position_identifier: SpotPositionIdentifier_V3): Promise<string | null> {
    return this.getAsync(this._key(spot_position_identifier))
  }
}
