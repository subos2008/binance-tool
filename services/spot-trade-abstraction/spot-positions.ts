import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { SpotExecutionEngine } from "./execution-engine"
import { SpotPositionsPersistance } from "./spot-positions-persistance"
import { SpotPositionIdentifier } from "./spot-interfaces"

interface Position {
  direction: "long" | "short"
  quantity: string
  edge: string
}

export interface OpenPositionCommand {}

/**
 * If this does the tracking in redis and the exchange orders things get a log cleaner
 *
 * Note this is instantiated with a particular exchange, the exchange identifier is
 * fixed at instantiation
 */
export class SpotPositions {
  logger: Logger
  ee: SpotExecutionEngine

  positions_persistance: SpotPositionsPersistance

  constructor({
    logger,
    ee,
    positions_persistance,
  }: {
    logger: Logger
    ee: SpotExecutionEngine
    positions_persistance: SpotPositionsPersistance
  }) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
    this.positions_persistance = positions_persistance
  }

  in_position({ base_asset }: { base_asset: string }) {
    return this.positions_persistance.in_position({
      base_asset,
      exchange_identifier: this.ee.get_exchange_identifier(),
    })
  }

  exisiting_position_size({ base_asset }: { base_asset: string }) {
    return this.positions_persistance.position_size({
      base_asset,
      exchange_identifier: this.ee.get_exchange_identifier(),
    })
  }

  // Used when constructing orders
  private get_market_identifier_for(args: { quote_asset: string; base_asset: string }): MarketIdentifier_V3 {
    return this.ee.get_market_identifier_for(args)
  }

  /* Open both does the order execution/tracking, sizing, and maintains redis */
  open_position({
    quote_asset,
    base_asset,
    direction,
    edge,
  }: {
    quote_asset: string
    base_asset: string
    direction: string
    edge: string
  }) {
    //   /**
    //    * Atomic open / set placeholder for position entry
    //    *  - add tradeID and have a timeout so if not opened with a real position soon it reverts to a clear spot?
    //    *
    //    * Open:
    //    * - throws if position is already open
    //    * - otherwise
    //    *
    //    *  */
    //   let trade_id = this.ee.get_new_trade_id()
    //   let reserved_position : ReservedPosition
    //   try {
    //     reserved_position = this.positions_persistance.reserve_position_if_not_already_existing({trade_id})
    //     if(/** didn't get a reserved position */) {
    //       throw new Error(`Failed to reserve position`)
    //     }
    //   }
    //   let {executed_base_quantity} = this.ee.market_buy()
    //   if(executed_base_quantity.isGreaterThanZero()) {
    //     let position:Position = {
    //       direction,
    //       edge,
    //       quantity: executed_base_quantity
    //     }
    //     this.positions_persistance.setup_reserved_position(reserved_position, position)
    //     this.ee.set_stop_for_position()
    //     // may not be a full sized position
    //     return {trade_id, position}
    //   }else{
    //     this.positions_persistance.cancel_reserved_position()
    //   }
  }

  async open_positions() {
    return this.positions_persistance.open_positions()
  }
}
