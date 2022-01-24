import { strict as assert } from "assert"
const { promisify } = require("util")

import { SpotPositionIdentifier } from "./spot-interfaces"
import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { RedisClient } from "redis"
import { InterimSpotPositionsMetaDataPersistantStorage } from "./trade-abstraction-service"

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

  private _key(pi: SpotPositionIdentifier) {
    return `RedisInterimSpotPositionsMetaDataPersistantStorage/${pi.exchange_identifier.exchange}/${pi.exchange_identifier.type}/${pi.base_asset}/stop_order_id`
  }
  async set_stop_order_id(spot_position_identifier: SpotPositionIdentifier, order_id: string): Promise<void> {
    this.setAsync(this._key(spot_position_identifier), order_id)
  }

  // null means no stop (known)
  async get_stop_order_id(spot_position_identifier: SpotPositionIdentifier): Promise<string | null> {
    return this.getAsync(this._key(spot_position_identifier))
  }
}
