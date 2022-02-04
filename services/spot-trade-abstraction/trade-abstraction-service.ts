import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import { SendMessageFunc } from "../../lib/telegram-v2"
import {
  AuthorisedEdgeType,
  check_edge,
  SpotPositionIdentifier_V3,
} from "../../classes/spot/abstractions/position-identifier"
import { SpotExecutionEngine } from "../../classes/spot/exchanges/interfaces/spot-execution-engine"
import { SpotPositionsExecution } from "../../classes/spot/execution/spot-positions-execution"

export interface TradeAbstractionOpenLongCommand {
  base_asset: string
  edge: string
  direction: "long"
  action: "open"
}

export interface TradeAbstractionCloseLongCommand {
  base_asset: string
  edge: string
  direction: "long"
  action: "close"
}

export interface InterimSpotPositionsMetaDataPersistantStorage {
  set_stop_order_id(spot_position_identifier: SpotPositionIdentifier_V3, order_id: string): Promise<void>
  get_stop_order_id(spot_position_identifier: SpotPositionIdentifier_V3): Promise<string | null>
}

/**
 * Convert "go long" / "go short" signals into ExecutionEngine commands
 */
export class TradeAbstractionService {
  logger: Logger
  send_message: SendMessageFunc
  quote_asset: string
  private positions: SpotPositionsQuery // query state of existing open positions
  private spot_ee: SpotPositionsExecution

  constructor({
    logger,
    send_message,
    quote_asset,
    positions,
    spot_ee
  }: {
    logger: Logger
    send_message: SendMessageFunc
    quote_asset: string
    positions: SpotPositionsQuery
    spot_ee: SpotPositionsExecution
  }) {
    assert(logger)
    this.logger = logger
    assert(quote_asset)
    this.quote_asset = quote_asset
    this.positions = positions
    this.send_message = send_message
    this.spot_ee = spot_ee
  }

  // or signal_long
  // Spot so we can only be long or no-position
  async open_spot_long(
    cmd: TradeAbstractionOpenLongCommand,
    send_message: (msg: string) => void
  ): Promise<object> {
    assert.equal(cmd.direction, "long")
    assert.equal(cmd.action, "open")
    let edge: AuthorisedEdgeType = check_edge(cmd.edge)
    /** TODO: We want this check and entry to be atomic, while we only trade one edge it's less important */
    this.logger.warn(`Position entry is not atomic with check for existing position`)
    let existing_spot_position_size: BigNumber = await this.positions.exisiting_position_size({
      base_asset: cmd.base_asset,
      edge,
    })

    if (existing_spot_position_size.isGreaterThan(0)) {
      let msg = `Already in long spot position on ${cmd.base_asset}, skipping`
      this.logger.warn(msg)
      send_message(msg)
      throw new Error(msg) // turn this into a 3xx or 4xx
    }

    let result = await this.spot_ee.open_position({ quote_asset: this.quote_asset, ...cmd, edge })
    this.send_message(
      `Entered ${cmd.direction}=long position on ${cmd.edge}:${
        cmd.base_asset
      } at price ${result.executed_price.toFixed()}, created stop at ${result.stop_price.toFixed()}`
    )
    return result
  }

  // or signal_short or signal_exit/close
  // Spot so we can only be long or no-position
  async close_spot_long(cmd: TradeAbstractionCloseLongCommand, send_message: (msg: string) => void) {
    assert.equal(cmd.direction, "long")
    assert.equal(cmd.action, "close")
    let edge = check_edge(cmd.edge)

    this.logger.warn(`Position exit is not atomic with check for existing position`)
    if (await this.positions.in_position({ base_asset: cmd.base_asset, edge })) {
      this.spot_ee.close_position({ quote_asset: this.quote_asset, ...cmd, edge })
      return
    }

    let msg = `There is no known long spot position on ${cmd.base_asset}, skipping close request`
    this.logger.warn(msg)
    send_message(msg)
    throw new Error(msg) // turn this into a 3xx or 4xx - 404?
  }

  async open_positions(): Promise<SpotPositionIdentifier_V3[]> {
    return this.positions.open_positions()
  }
}
