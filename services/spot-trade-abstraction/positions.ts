import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { SpotExecutionEngine } from "./execution-engine"
import { PositionsPersistance } from "./positions-persistance"

interface Position {
  direction: "long" | "short"
  quantity: string
  edge: string
}

export interface OpenPositionCommand {}

/**
 * If this does the tracking in redis and the exchange orders things get a log cleaner
 */
export class Positions {
  logger: Logger
  ee: SpotExecutionEngine

  positions_persistance: PositionsPersistance

  constructor({ logger, ee,positions_persistance }: { logger: Logger; ee: SpotExecutionEngine,positions_persistance: PositionsPersistance}) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
    this.positions_persistance = positions_persistance
  }

  // Used when storing things like Position state
  get_market_identifier_for(args: { quote_asset: string; base_asset: string }): MarketIdentifier_V3 {
    return this.ee.get_market_identifier_for(args)
  }

  // in_position(market: MarketIdentifier_V3) {
  //   if (!market.symbol) throw new Error(`MarketIdentifier must provide symbol`)
  //   return this.positions[market.symbol]
  // }

  // /* Open both does the order execution/tracking, sizing, and maintains redis with the result */
  // open({direction,edge}) {
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
  // }

  async open_positions() {
    return this.positions_persistance.open_positions()
  }
}
