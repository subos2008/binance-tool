import {
  PositionsPersistance,
  PositionReservationCommand,
  ReservedPosition,
  PositionInitialisationData,
} from "./positions-persistance"

import { Logger } from "../../interfaces/logger"

import { RedisPositionsState } from "../../classes/persistent_state/redis_positions_state"
import { RedisClient } from "redis"
import { get_redis_client, set_redis_logger } from "../../lib/redis"
import { PositionIdentifier } from "../../events/shared/position-identifier"

export class RedisPositionsStateAdapter implements PositionsPersistance {
  logger: Logger
  legacy: RedisPositionsState

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
    set_redis_logger(logger)
    let redis: RedisClient = get_redis_client()
    this.legacy = new RedisPositionsState({ logger, redis })
  }

  async reserve_position_if_not_already_existing(
    cmd: PositionReservationCommand
  ): Promise<ReservedPosition | null> {
    return null
  }
  async cancel_reserved_position(reserved_position: ReservedPosition): Promise<void> {}
  /** setup_reserved_position: once the orders have executed and we have a position, call this
   * to make it real
   */
  async setup_reserved_position(
    reserved_position: ReservedPosition,
    position_initialisation_data: PositionInitialisationData
  ): Promise<void> {}

  async open_positions(): Promise<PositionIdentifier[]> {
    let legacy_pis: PositionIdentifier[] = await this.legacy.open_positions()
    console.log(legacy_pis)
    return legacy_pis
  }
}
