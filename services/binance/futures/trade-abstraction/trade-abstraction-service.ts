import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { disallowed_base_assets_for_entry } from "../../../../lib/stable-coins"

import { SendMessage, SendMessageFunc } from "../../../../lib/telegram-v2"

import Sentry from "../../../../lib/sentry"
import { Logger } from "../../../../interfaces/logger"
import { strict as assert } from "assert"
import {
  TradeAbstractionOpenFuturesShortCommand,
  TradeAbstractionOpenFuturesShortResult,
} from "./interfaces/short"
import {
  AuthorisedEdgeType,
  BinanceStyleSpotPrices,
  check_edge,
  is_authorised_edge,
} from "../../../../classes/spot/abstractions/position-identifier"
import { FuturesEdgeToExecutorMapper } from "./execution/futures-edge-to-executor-mapper"
import { FuturesExecutionEngine } from "./execution/execution_engines/futures-execution-engine"
import { FixedPositionSizer, PositionSizer } from "../../../../edges/position-sizer/fixed-position-sizer"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
// import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
// import {
//   AuthorisedEdgeType,
//   check_edge,
//   is_authorised_edge,
//   SpotPositionIdentifier_V3,
// } from "../../classes/spot/abstractions/position-identifier"

/**
 * Convert "go long" / "go short" signals into ExecutionEngine commands
 */

export class FuturesTradeAbstractionService {
  logger: Logger
  quote_asset: string
  // private positions: SpotPositionsQuery // query state of existing open positions
  private ee: FuturesExecutionEngine
  private eem: FuturesEdgeToExecutorMapper
  position_sizer: PositionSizer

  constructor({
    logger,
    quote_asset,
    // positions,
    ee,
    send_message,
  }: {
    logger: Logger
    quote_asset: string
    // positions: SpotPositionsQuery
    ee: FuturesExecutionEngine
    send_message: SendMessageFunc
  }) {
    assert(logger)
    this.logger = logger
    assert(quote_asset)
    this.quote_asset = quote_asset
    // this.positions = positions
    this.ee = ee
    this.position_sizer = new FixedPositionSizer({ logger })
    this.eem = new FuturesEdgeToExecutorMapper({
      logger,
      ee,
      send_message,
      position_sizer: this.position_sizer,
    })
  }

  get_exchange_identifier(): ExchangeIdentifier_V3 {
    return this.ee.get_exchange_identifier()
  }

  async prices(): Promise<BinanceStyleSpotPrices> {
    return this.ee.prices()
  }

  async open_positions() /*: Promise<SpotPositionIdentifier_V3[]>*/ {
    throw new Error(`Not implemented`)
    // return this.positions.open_positions()
  }

  async short(cmd: TradeAbstractionOpenFuturesShortCommand): Promise<TradeAbstractionOpenFuturesShortResult> {
    this.logger.info(cmd)
    assert.equal(cmd.direction, "long")
    assert.equal(cmd.action, "open")
    cmd.quote_asset = this.quote_asset

    if (!is_authorised_edge(cmd.edge)) {
      let err = new Error(`UnauthorisedEdge ${cmd.edge}`)
      this.logger.warn({ err })
      let obj: TradeAbstractionOpenFuturesShortResult = {
        object_type: "TradeAbstractionOpenFuturesShortResult",
        version: 1,
        base_asset: cmd.base_asset,
        quote_asset: this.quote_asset,
        edge: cmd.edge,
        status: "UNAUTHORISED",
        msg: err.message,
        err,
      }
      return obj
    }

    if (disallowed_base_assets_for_entry.includes(cmd.base_asset)) {
      let err = new Error(`Opening spot long positions in ${cmd.base_asset} is explicity disallowed`)
      this.logger.warn({ err })
      let obj: TradeAbstractionOpenFuturesShortResult = {
        object_type: "TradeAbstractionOpenFuturesShortResult",
        version: 1,
        base_asset: cmd.base_asset,
        quote_asset: this.quote_asset,
        edge: cmd.edge,
        status: "UNAUTHORISED",
        msg: err.message,
        err,
      }
      return obj
    }

    let edge: AuthorisedEdgeType = check_edge(cmd.edge)

    this.logger.warn(`Position entry is not atomic with check for existing position`)
    this.logger.error(`Futures TAS existion position check: unimplemented`)
    // let existing_spot_position_size: BigNumber = await this.positions.exisiting_position_size({
    //   base_asset: cmd.base_asset,
    //   edge,
    // })

    // if (existing_spot_position_size.isGreaterThan(0)) {
    //   let obj: TradeAbstractionOpenSpotLongResult = {
    //     object_type: "TradeAbstractionOpenSpotLongResult",
    //     version: 1,
    //     base_asset: cmd.base_asset,
    //     quote_asset: this.quote_asset,
    //     edge,
    //     status: "ALREADY_IN_POSITION",
    //     msg: `TradeAbstractionOpenSpotLongResult: ${edge}${cmd.base_asset}: ALREADY_IN_POSITION`,
    //   }
    //   return obj
    // }

    throw new Error(`futures open_short not implemented`)

    // let result: TradeAbstractionOpenFuturesShortResult = await this.ee.open_position(cmd)
    // if (
    //   result.status != "INTERNAL_SERVER_ERROR" &&
    //   result.status != "ENTRY_FAILED_TO_FILL" &&
    //   result.status != "UNAUTHORISED" &&
    //   result.status != "ALREADY_IN_POSITION" &&
    //   result.status != "TRADING_IN_ASSET_PROHIBITED"
    // ) {
    //   result.created_stop_order = result.stop_order_id ? true : false
    //   result.created_take_profit_order = result.take_profit_order_id ? true : false
    // }

    // let { execution_timestamp_ms } = result
    // result.signal_to_execution_slippage_ms = execution_timestamp_ms
    //   ? new BigNumber(execution_timestamp_ms).minus(cmd.signal_timestamp_ms).toFixed()
    //   : undefined

    // return result
  }

  // // or signal_short or signal_exit/close
  // // Spot so we can only be long or no-position
  // async close_spot_long(cmd: TradeAbstractionCloseLongCommand): Promise<TradeAbstractionCloseSpotLongResult> {
  //   assert.equal(cmd.direction, "long")
  //   assert.equal(cmd.action, "close")
  //   let edge: AuthorisedEdgeType = cmd.edge as AuthorisedEdgeType
  //   let { base_asset } = cmd
  //   let { quote_asset } = this

  //   this.logger.warn(`Position exit is not atomic with check for existing position`)
  //   try {
  //     let result: TradeAbstractionCloseSpotLongResult = await this.ee.close_position({
  //       quote_asset,
  //       ...cmd,
  //       edge,
  //     })
  //     return result
  //   } catch (err) {
  //     Sentry.captureException(err)
  //     this.logger.error({ err })
  //     throw err
  //   }
  // }

  // async open_positions(): Promise<SpotPositionIdentifier_V3[]> {
  //   return this.positions.open_positions()
  // }
}
