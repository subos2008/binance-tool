import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

let disallowed_coins_for_entry = ["UST", "GBP", "USDT", "EGLD"]

import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import {
  AuthorisedEdgeType,
  check_edge,
  is_authorised_edge,
  SpotPositionIdentifier_V3,
} from "../../classes/spot/abstractions/position-identifier"
import { SpotPositionsExecution } from "../../classes/spot/execution/spot-positions-execution"
import Sentry from "../../lib/sentry"

export interface TradeAbstractionOpenSpotLongCommand {
  base_asset: string
  quote_asset?: string // added by the TAS before it hits the EE
  edge: AuthorisedEdgeType
  direction: "long"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: string
}

interface TradeAbstractionOpenSpotLongResult_SUCCESS {
  object_type: "TradeAbstractionOpenSpotLongResult"
  version: 1
  base_asset: string
  quote_asset: string
  edge: string

  status: "SUCCESS" // full or partial entry, all good

  // signal
  trigger_price?: string

  // Buy execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price?: string // can be null if nothing bought
  execution_timestamp_ms?: string
  execution_time_slippage_ms?: string

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}
interface TradeAbstractionOpenSpotLongResult_INTERNAL_SERVER_ERROR {
  object_type: "TradeAbstractionOpenSpotLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "INTERNAL_SERVER_ERROR" // exception caught

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: string
  execution_time_slippage_ms?: string
}
interface TradeAbstractionOpenSpotLongResult_ENTRY_FAILED_TO_FILL {
  object_type: "TradeAbstractionOpenSpotLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ENTRY_FAILED_TO_FILL" // limit buy didn't manage to fill

  msg?: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  // signal
  trigger_price?: string

  // Buy execution
  execution_timestamp_ms?: string
  execution_time_slippage_ms?: string
}
interface TradeAbstractionOpenSpotLongResult_UNAUTHORISED {
  object_type: "TradeAbstractionOpenSpotLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "UNAUTHORISED" // atm means edge not recognised

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: string
  execution_time_slippage_ms?: string
}

interface TradeAbstractionOpenSpotLongResult_ALREADY_IN_POSITION {
  object_type: "TradeAbstractionOpenSpotLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ALREADY_IN_POSITION" // Didn't enter because already in this position

  msg?: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  executed_price?: string // null if nothing bought
  execution_timestamp_ms?: string
  execution_time_slippage_ms?: string
}
interface TradeAbstractionOpenSpotLongResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS {
  object_type: "TradeAbstractionOpenSpotLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ABORTED_FAILED_TO_CREATE_EXIT_ORDERS" // exited (dumped) the postition as required exit orders couldn't be created

  msg?: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  
  // Buy execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price?: string // can be null if nothing bought
  execution_timestamp_ms?: string
  execution_time_slippage_ms?: string

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}

export type TradeAbstractionOpenSpotLongResult =
  | TradeAbstractionOpenSpotLongResult_SUCCESS
  | TradeAbstractionOpenSpotLongResult_INTERNAL_SERVER_ERROR
  | TradeAbstractionOpenSpotLongResult_ENTRY_FAILED_TO_FILL
  | TradeAbstractionOpenSpotLongResult_UNAUTHORISED
  | TradeAbstractionOpenSpotLongResult_ALREADY_IN_POSITION
  | TradeAbstractionOpenSpotLongResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS

export interface TradeAbstractionCloseSpotLongResult {
  object_type: "TradeAbstractionCloseSpotLongResult"
  version: 1
  base_asset: string
  quote_asset: string
  edge: string
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
  quote_asset: string
  private positions: SpotPositionsQuery // query state of existing open positions
  private spot_ee: SpotPositionsExecution

  constructor({
    logger,
    quote_asset,
    positions,
    spot_ee,
  }: {
    logger: Logger
    quote_asset: string
    positions: SpotPositionsQuery
    spot_ee: SpotPositionsExecution
  }) {
    assert(logger)
    this.logger = logger
    assert(quote_asset)
    this.quote_asset = quote_asset
    this.positions = positions
    this.spot_ee = spot_ee
  }

  // or signal_long
  // Spot so we can only be long or no-position
  async open_spot_long(cmd: TradeAbstractionOpenSpotLongCommand): Promise<TradeAbstractionOpenSpotLongResult> {
    this.logger.info(cmd)
    assert.equal(cmd.direction, "long")
    assert.equal(cmd.action, "open")
    cmd.quote_asset = this.quote_asset

    if (!is_authorised_edge(cmd.edge)) {
      let err = new Error(`UnauthorisedEdge ${cmd.edge}`)
      this.logger.warn({ err })
      let obj: TradeAbstractionOpenSpotLongResult = {
        object_type: "TradeAbstractionOpenSpotLongResult",
        version: 1,
        base_asset: cmd.base_asset,
        quote_asset: this.quote_asset,
        edge: cmd.edge,
        status: "UNAUTHORISED",
        msg: err.message,
        err,
      }
      this.logger.object(obj)
      return obj
    }

    if (disallowed_coins_for_entry.includes(cmd.base_asset)) {
      throw new Error(`Opening spot long positions in ${cmd.base_asset} is explicity disallowed`)
    }

    let edge: AuthorisedEdgeType = check_edge(cmd.edge)

    this.logger.warn(`Position entry is not atomic with check for existing position`)
    let existing_spot_position_size: BigNumber = await this.positions.exisiting_position_size({
      base_asset: cmd.base_asset,
      edge,
    })

    if (existing_spot_position_size.isGreaterThan(0)) {
      let obj: TradeAbstractionOpenSpotLongResult = {
        object_type: "TradeAbstractionOpenSpotLongResult",
        version: 1,
        base_asset: cmd.base_asset,
        quote_asset: this.quote_asset,
        edge,
        status: "ALREADY_IN_POSITION",
      }
      this.logger.object(obj)
      return obj
    }

    let result: TradeAbstractionOpenSpotLongResult = await this.spot_ee.open_position(cmd)
    if (
      result.status != "INTERNAL_SERVER_ERROR" &&
      result.status != "ENTRY_FAILED_TO_FILL" &&
      result.status != "UNAUTHORISED" &&
      result.status != "ALREADY_IN_POSITION"
    ) {
      result.created_stop_order = result.stop_order_id ? true : false
      result.created_take_profit_order = result.take_profit_order_id ? true : false
    }

    let { execution_timestamp_ms } = result
    result.execution_time_slippage_ms = execution_timestamp_ms
      ? new BigNumber(execution_timestamp_ms).minus(cmd.signal_timestamp_ms).toFixed()
      : undefined

    this.logger.object(result)
    return result
  }

  // or signal_short or signal_exit/close
  // Spot so we can only be long or no-position
  async close_spot_long(cmd: TradeAbstractionCloseLongCommand): Promise<TradeAbstractionCloseSpotLongResult> {
    assert.equal(cmd.direction, "long")
    assert.equal(cmd.action, "close")
    let edge: AuthorisedEdgeType = cmd.edge as AuthorisedEdgeType

    this.logger.warn(`Position exit is not atomic with check for existing position`)
    try {
      if (await this.positions.in_position({ base_asset: cmd.base_asset, edge })) {
        let result = await this.spot_ee.close_position({ quote_asset: this.quote_asset, ...cmd, edge })
        // success
        return {
          object_type: "TradeAbstractionCloseSpotLongResult",
          version: 1,
          base_asset: result.base_asset,
          quote_asset: result.quote_asset,
          edge,
        }
      }
    } catch (error) {
      Sentry.captureException(error)
      console.error(error)
      throw error
    }

    let msg = `There is no known long spot position on ${cmd.base_asset}, skipping close request`
    this.logger.warn(msg)
    throw new Error(msg) // turn this into a 3xx or 4xx - 404?
  }

  async open_positions(): Promise<SpotPositionIdentifier_V3[]> {
    return this.positions.open_positions()
  }
}
