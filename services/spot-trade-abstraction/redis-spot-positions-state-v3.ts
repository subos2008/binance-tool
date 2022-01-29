/**
 * This originally bridged the new interface to the old redis positions state (some thunky hacks)
 * 
 * Now it bridges just the old to new interface
 */

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { SpotPositionsPersistance, SpotPositionInitialisationData } from "./spot-positions-persistance"

import { Logger } from "../../interfaces/logger"

import { RedisSpotPositionsState } from "../../classes/persistent_state/redis-spot-positions-state-v3"
import { RedisClient } from "redis"
import { SpotPositionIdentifier_V3 } from "../../events/shared/position-identifier"
import { PositionObject as LegacyPositionObject } from "../../classes/position"

export class SpotRedisPositionsState implements SpotPositionsPersistance {
  logger: Logger
  state: RedisSpotPositionsState

  constructor({ logger, redis }: { logger: Logger; redis: RedisClient }) {
    this.logger = logger
    this.state = new RedisSpotPositionsState({ logger, redis })
  }

  async initialise_position(
    pi: SpotPositionIdentifier_V3,
    position_initialisation_data: SpotPositionInitialisationData
  ): Promise<void> {
    let po: LegacyPositionObject = position_initialisation_data
    await this.state.create_new_position(pi, po)
  }

  async in_position(pi: SpotPositionIdentifier_V3): Promise<boolean> {
    return (await this.position_size(pi)).isGreaterThan(0)
  }

  async position_size(pi: SpotPositionIdentifier_V3): Promise<BigNumber> {
    if (!pi.base_asset) throw new Error(`Must set base_asset in the market identifier to check position_size`)
    return this.state.get_position_size(pi)
  }

  async list_open_positions(): Promise<SpotPositionIdentifier_V3[]> {
    let pis: SpotPositionIdentifier_V3[] = await this.state.open_positions()
    console.log(pis)
    return pis
  }
}
