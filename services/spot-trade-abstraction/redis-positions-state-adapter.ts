import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { SpotPositionsPersistance, SpotPositionInitialisationData } from "./spot-positions-persistance"

import { Logger } from "../../interfaces/logger"

import { RedisPositionsState } from "../../classes/persistent_state/redis_positions_state"
import { RedisClient } from "redis"
import { get_redis_client, set_redis_logger } from "../../lib/redis"
import { PositionIdentifier as LegacyPositionIdentifier } from "../../events/shared/position-identifier"
import { PositionObject as LegacyPositionObject } from "../../classes/position"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { SpotPositionIdentifier } from "./spot-interfaces"

export class SpotRedisPositionsStateAdapter implements SpotPositionsPersistance {
  logger: Logger
  legacy: RedisPositionsState

  constructor({ logger ,redis}: { logger: Logger, redis:RedisClient }) {
    this.logger = logger
    this.legacy = new RedisPositionsState({ logger, redis })
  }

  async initialise_position(
    pi: SpotPositionIdentifier,
    position_initialisation_data: SpotPositionInitialisationData
  ): Promise<void> {
    let _pi: LegacyPositionIdentifier = {
      baseAsset: pi.base_asset,
      exchange_identifier: { account: "default", ...pi.exchange_identifier },
    }
    let po: LegacyPositionObject = position_initialisation_data
    await this.legacy.create_new_position(_pi, po)
  }

  async in_position(pi: SpotPositionIdentifier): Promise<boolean> {
    return (await this.position_size(pi)).isGreaterThan(0)
  }

  async position_size(pi: SpotPositionIdentifier): Promise<BigNumber> {
    if (!pi.base_asset) throw new Error(`Must set base_asset in the market identifier to check position_size`)
    let _pi: LegacyPositionIdentifier = {
      baseAsset: pi.base_asset,
      exchange_identifier: { account: "default", ...pi.exchange_identifier },
    }
    return this.legacy.get_position_size(_pi)
  }

  async list_open_positions(): Promise<SpotPositionIdentifier[]> {
    let legacy_pis: LegacyPositionIdentifier[] = await this.legacy.open_positions()
    console.log(legacy_pis)
    return legacy_pis.map((x) => ({
      base_asset: x.baseAsset,
      exchange_identifier: { exchange: x.exchange_identifier.exchange, type: "spot", version: "v3" },
    }))
  }
}
