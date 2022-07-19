import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { disallowed_base_assets_for_entry } from "../../../../lib/stable-coins"

import { Logger } from "../../../../interfaces/logger"
import { strict as assert } from "assert"
import { SpotPositionsQuery } from "../../../../classes/spot/abstractions/spot-positions-query"
import {
  AuthorisedEdgeType,
  BinanceStyleSpotPrices,
  check_edge,
  is_authorised_edge,
  SpotPositionIdentifier_V3,
} from "../../../../classes/spot/abstractions/position-identifier"
import { SpotPositionsExecution } from "./execution/spot-positions-execution"
import Sentry from "../../../../lib/sentry"
import { TradeAbstractionOpenLongCommand, TradeAbstractionOpenLongResult } from "./interfaces/long"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { SpotPositionsPersistance } from "../../../../classes/spot/persistence/interface/spot-positions-persistance"
import { RedisSpotPositionsPersistance } from "../../../../classes/spot/persistence/redis-implementation/redis-spot-positions-persistance-v3"
import { BinancePriceGetter } from "../../../../interfaces/exchanges/binance/binance-price-getter"
import { BinanceSpotExecutionEngine as ExecutionEngine } from "./execution/execution_engines/binance-spot-execution-engine"
import { SendMessageFunc } from "../../../../classes/send_message/publish"
import { RedisClient } from "redis"
import { TradeAbstractionCloseCommand, TradeAbstractionCloseResult } from "./interfaces/close"

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
    quote_asset,
    ee,
    send_message,
    redis,
  }: {
    logger: Logger
    quote_asset: string
    ee: ExecutionEngine
    send_message: SendMessageFunc
    redis: RedisClient
  }) {
    assert(logger)
    this.logger = logger
    this.send_message = send_message
    assert(quote_asset)
    this.quote_asset = quote_asset
    const positions_persistance: SpotPositionsPersistance = new RedisSpotPositionsPersistance({ logger, redis })

    this.positions = new SpotPositionsQuery({
      logger,
      positions_persistance,
      send_message,
      exchange_identifier: ee.get_exchange_identifier(),
    })
    const price_getter = new BinancePriceGetter({
      logger,
      ee: ee.get_raw_binance_ee(),
      cache_timeout_ms: 400,
    })
    this.spot_ee = new SpotPositionsExecution({
      logger,
      positions_persistance,
      ee,
      send_message,
      price_getter,
    })
  }

  get_exchange_identifier(): ExchangeIdentifier_V3 {
    return this.spot_ee.ee.get_exchange_identifier()
  }

  prices(): Promise<BinanceStyleSpotPrices> {
    return this.spot_ee.ee.prices()
  }

  // or signal_long
  // Spot so we can only be long or no-position
  async long(cmd: TradeAbstractionOpenLongCommand): Promise<TradeAbstractionOpenLongResult> {
    this.logger.info(cmd)
    assert.equal(cmd.direction, "long")
    assert.equal(cmd.action, "open")
    cmd.quote_asset = this.quote_asset

    let tags = { edge: cmd.edge, base_asset: cmd.base_asset, quote_asset: cmd.quote_asset }

    if (!is_authorised_edge(cmd.edge)) {
      let err = new Error(`UnauthorisedEdge ${cmd.edge}`)
      this.logger.warn({ err })
      let spot_long_result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        version: 1,
        base_asset: cmd.base_asset,
        quote_asset: this.quote_asset,
        edge: cmd.edge,
        status: "UNAUTHORISED",
        http_status: 403,
        msg: err.message,
        err,
      }
      this.logger.info(spot_long_result)
      return spot_long_result
    }

    if (disallowed_base_assets_for_entry.includes(cmd.base_asset)) {
      let err = new Error(`Opening spot long positions in ${cmd.base_asset} is explicity disallowed`)
      this.logger.warn({ err })
      let spot_long_result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        version: 1,
        base_asset: cmd.base_asset,
        quote_asset: this.quote_asset,
        edge: cmd.edge,
        status: "UNAUTHORISED",
        http_status: 403,
        msg: err.message,
        err,
      }
      this.logger.info(spot_long_result)
      return spot_long_result
    }

    let edge: AuthorisedEdgeType = check_edge(cmd.edge)

    this.logger.warn(`Position entry is not atomic with check for existing position`)
    let existing_spot_position_size: BigNumber = await this.positions.exisiting_position_size({
      base_asset: cmd.base_asset,
      edge,
    })

    if (existing_spot_position_size.isGreaterThan(0)) {
      let spot_long_result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        version: 1,
        base_asset: cmd.base_asset,
        quote_asset: this.quote_asset,
        edge,
        status: "ALREADY_IN_POSITION",
        http_status: 409,
        msg: `TradeAbstractionOpenLongResult: ${edge}${cmd.base_asset}: ALREADY_IN_POSITION`,
      }
      this.logger.info(spot_long_result)
      return spot_long_result
    }

    let result: TradeAbstractionOpenLongResult = await this.spot_ee.open_position(cmd)
    if (
      result.status != "INTERNAL_SERVER_ERROR" &&
      result.status != "ENTRY_FAILED_TO_FILL" &&
      result.status != "UNAUTHORISED" &&
      result.status != "ALREADY_IN_POSITION" &&
      result.status != "TRADING_IN_ASSET_PROHIBITED" &&
      result.status != "INSUFFICIENT_BALANCE" &&
      result.status != "BAD_INPUTS" &&
      result.status != "TOO_MANY_REQUESTS"
    ) {
      result.created_stop_order = result.stop_order_id ? true : false
      result.created_take_profit_order = result.take_profit_order_id ? true : false
    }

    let { execution_timestamp_ms } = result
    result.signal_to_execution_slippage_ms = execution_timestamp_ms
      ? new BigNumber(execution_timestamp_ms).minus(cmd.signal_timestamp_ms).toFixed()
      : undefined

    return result
  }

  // or signal_short or signal_exit/close
  // Spot so we can only be long or no-position
  async close(cmd: TradeAbstractionCloseCommand): Promise<TradeAbstractionCloseResult> {
    assert.equal(cmd.action, "close")
    let { quote_asset } = this

    this.logger.warn(`Position exit is not atomic with check for existing position`)
    try {
      let result: TradeAbstractionCloseResult = await this.spot_ee.close_position(cmd, { quote_asset })
      return result
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err })
      throw err
    }
  }

  async open_positions(): Promise<SpotPositionIdentifier_V3[]> {
    return this.positions.open_positions()
  }
}
