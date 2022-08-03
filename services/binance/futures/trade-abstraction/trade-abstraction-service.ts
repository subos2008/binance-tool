import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { disallowed_base_assets_for_entry } from "../../../../lib/stable-coins"
import Sentry from "../../../../lib/sentry"
import { Logger } from "../../../../interfaces/logger"
import { strict as assert } from "assert"
import { TradeAbstractionOpenShortCommand, TradeAbstractionOpenShortResult } from "./interfaces/short"
import {
  AuthorisedEdgeType,
  BinanceStyleSpotPrices,
  check_edge,
  is_authorised_edge,
} from "../../../../classes/spot/abstractions/position-identifier"
import { FuturesEdgeToExecutorMapper } from "./edge-to-executor-mapper"
import { FixedPositionSizer, PositionSizer } from "../../../../edges/position-sizer/fixed-position-sizer"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { BinanceFuturesExecutionEngine } from "./execution/execution_engines/binance-futures-execution-engine"
import { BinanceFuturesPriceGetter } from "../../../../interfaces/exchanges/binance/binance-price-getter"
import { TradeAbstractionCloseCommand, TradeAbstractionCloseResult } from "./interfaces/close"
import { SendMessageFunc } from "../../../../interfaces/send-message"

/**
 * Convert "go long" / "go short" signals into ExecutionEngine commands
 */

export class FuturesTradeAbstractionService {
  logger: Logger
  quote_asset: string
  // private positions: SpotPositionsQuery // query state of existing open positions
  private ee: BinanceFuturesExecutionEngine
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
    ee: BinanceFuturesExecutionEngine
    send_message: SendMessageFunc
  }) {
    assert(logger)
    this.logger = logger
    assert(quote_asset)
    this.quote_asset = quote_asset
    // this.positions = positions
    this.ee = ee
    this.position_sizer = new FixedPositionSizer({ logger })
    let price_getter = new BinanceFuturesPriceGetter({
      logger,
      ee: ee.get_raw_binance_ee(),
      cache_timeout_ms: 3000,
    })
    this.eem = new FuturesEdgeToExecutorMapper({
      logger,
      ee,
      send_message,
      position_sizer: this.position_sizer,
      price_getter,
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

  async short(cmd: TradeAbstractionOpenShortCommand): Promise<TradeAbstractionOpenShortResult> {
    this.logger.info(cmd)
    assert.equal(cmd.direction, "short")
    assert.equal(cmd.action, "open")

    let { direction } = cmd

    if (!is_authorised_edge(cmd.edge)) {
      let err = new Error(`UnauthorisedEdge ${cmd.edge}`)
      this.logger.warn({ err })
      let obj: TradeAbstractionOpenShortResult = {
        object_type: "TradeAbstractionOpenShortResult",
        version: 1,
        base_asset: cmd.base_asset,
        quote_asset: this.quote_asset,
        edge: cmd.edge,
        status: "UNAUTHORISED",
        http_status: 403,
        buy_filled: false,
        msg: err.message,
        err,
        created_stop_order: false,
        created_take_profit_order: false,
      }
      this.logger.info(obj)
      return obj
    }

    if (disallowed_base_assets_for_entry.includes(cmd.base_asset)) {
      let err = new Error(`Opening ${direction} position in ${cmd.base_asset} is explicity disallowed`)
      this.logger.warn({ err })
      let obj: TradeAbstractionOpenShortResult = {
        object_type: "TradeAbstractionOpenShortResult",
        version: 1,
        base_asset: cmd.base_asset,
        quote_asset: this.quote_asset,
        edge: cmd.edge,
        status: "UNAUTHORISED",
        http_status: 403,
        buy_filled: false,
        msg: err.message,
        err,
        created_stop_order: false,
        created_take_profit_order: false,
      }
      this.logger.info(obj)

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

    let { quote_asset } = this
    let result: TradeAbstractionOpenShortResult = await this.eem.short({ ...cmd, quote_asset })

    result.created_stop_order = result.stop_order_id ? true : false
    result.created_take_profit_order = result.take_profit_order_id ? true : false

    let { execution_timestamp_ms } = result
    result.signal_to_execution_slippage_ms = execution_timestamp_ms
      ? execution_timestamp_ms - cmd.signal_timestamp_ms
      : undefined

    return result
  }

  async close(cmd: TradeAbstractionCloseCommand): Promise<TradeAbstractionCloseResult> {
    try {
      throw new Error(`close Not implemented`)
      // assert.equal(cmd.action, "close")
      // let edge: AuthorisedEdgeType = cmd.edge as AuthorisedEdgeType
      // let { base_asset } = cmd
      // let { quote_asset } = this

      // let market_identifier = await this.ee.get_market_identifier_for({ quote_asset, base_asset })
      // this.logger.warn(`Position exit is not atomic with check for existing position`)
      // let tags = { base_asset, quote_asset, edge }
      // let result: TradeAbstractionCloseResult = await this.ee.close(
      //   tags,
      //   {
      //     ...cmd,
      //     edge,
      //   },
      //   { market_identifier }
      // )
      // return result
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err })
      throw err
    }
  }

  // async open_positions(): Promise<SpotPositionIdentifier_V3[]> {
  //   return this.positions.open_positions()
  // }
}
