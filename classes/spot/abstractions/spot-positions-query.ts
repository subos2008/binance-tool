import { strict as assert } from "assert"

import Sentry from "../../../lib/sentry"

import { Logger } from "../../../interfaces/logger"
import { SpotPositionsPersistence } from "../persistence/interface/spot-positions-persistance"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../events/shared/exchange-identifier"
import { SpotPositionIdentifier_V3, SpotPositionsQuery_V3 } from "./position-identifier"
import { SpotPosition } from "./spot-position"
import { SendMessageFunc } from "../../../interfaces/send-message"

/**
 * High level abstraction for querying positions - queries the persistent state
 *
 * Doesn't need access to an ExecutionEngine
 *
 * Note this is instantiated with a particular exchange, the exchange identifier is
 * fixed at instantiation
 */
export class SpotPositionsQuery {
  logger: Logger
  send_message: SendMessageFunc
  exchange_identifier: ExchangeIdentifier_V4
  positions_persistance: SpotPositionsPersistence

  constructor({
    logger,
    positions_persistance,
    send_message,
    exchange_identifier,
  }: {
    logger: Logger
    positions_persistance: SpotPositionsPersistence
    send_message: SendMessageFunc
    exchange_identifier: ExchangeIdentifier_V4
  }) {
    assert(logger)
    this.logger = logger
    this.positions_persistance = positions_persistance
    this.send_message = send_message
    this.exchange_identifier = exchange_identifier
  }

  in_position({ base_asset, edge }: { base_asset: string; edge: string }) {
    return this.positions_persistance.in_position({
      base_asset,
      exchange_identifier: this.exchange_identifier,
      edge,
    })
  }

  exisiting_position_size({ base_asset, edge }: { base_asset: string; edge: string }) {
    return this.positions_persistance.position_size({
      base_asset,
      exchange_identifier: this.exchange_identifier,
      edge,
    })
  }

  get_exchange_identifier(): ExchangeIdentifier_V4 {
    return this.exchange_identifier
  }

  async open_positions(): Promise<SpotPositionIdentifier_V3[]> {
    return await this.positions_persistance.list_open_positions()
  }

  async query_open_positions(pq: SpotPositionsQuery_V3): Promise<SpotPositionIdentifier_V3[]> {
    let positions = await this.open_positions()
    /**
     * export interface SpotPositionsQuery_V3 {
        exchange_identifier: ExchangeIdentifier_V3
        edge?: AuthorisedEdgeType // if edge is null return an array if there are multiple open positions
        base_asset: string
      }
     */
    // should all the above be optional? Except that spot is implicit
    // is open_positions already by exchange? if not filter by it
    // base asset certainly we filter by, that would mean spot anyway as it's base_asset instead of market already
    // edge we filter by if it is provided
    throw new Error(`not implemented`)
    return positions
  }

  async position(position_identifier: SpotPositionIdentifier_V3): Promise<SpotPosition> {
    // I think we can add orders to positions before they exist so this is kinda valid...
    // We might want some flag or call to check a position exists
    // this.logger.warn(
    //   `SpotPositionsQuery.position() doesn't ensure the positions exists before returning a SpotPosition object`
    // )
    return new SpotPosition({
      logger: this.logger,
      send_message: this.send_message,
      position_identifier,
      spot_positions_persistance: this.positions_persistance,
    })
  }
}
