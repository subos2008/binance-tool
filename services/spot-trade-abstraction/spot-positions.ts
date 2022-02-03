import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import {
  SpotExecutionEngine,
  SpotMarketBuyByQuoteQuantityCommand,
  SpotStopMarketSellCommand,
} from "./execution-engine"
import { SpotPositionsPersistance } from "./spot-positions-persistance"
import { SpotPositionIdentifier } from "./spot-interfaces"
import { SendMessageFunc } from "../../lib/telegram-v2"
import { PositionSizer } from "./position-sizer"
import BigNumber from "bignumber.js"
import { InterimSpotPositionsMetaDataPersistantStorage } from "./trade-abstraction-service"
import { ExchangeIdentifier_V3 } from "../../events/shared/exchange-identifier"
import Sentry from "../../lib/sentry"
import { SpotPositionsQuery_V3 } from "../../events/shared/position-identifier"

/**
 * If this does the tracking in redis and the exchange orders things get a log cleaner
 *
 * Note this is instantiated with a particular exchange, the exchange identifier is
 * fixed at instantiation
 */
export class SpotPositions {
  logger: Logger
  ee: SpotExecutionEngine
  send_message: SendMessageFunc
  position_sizer: PositionSizer
  interim_spot_positions_metadata_persistant_storage: InterimSpotPositionsMetaDataPersistantStorage

  positions_persistance: SpotPositionsPersistance

  constructor({
    logger,
    ee,
    positions_persistance,
    send_message,
    position_sizer,
    interim_spot_positions_metadata_persistant_storage,
  }: {
    logger: Logger
    ee: SpotExecutionEngine
    positions_persistance: SpotPositionsPersistance
    send_message: SendMessageFunc
    position_sizer: PositionSizer
    interim_spot_positions_metadata_persistant_storage: InterimSpotPositionsMetaDataPersistantStorage
  }) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
    this.positions_persistance = positions_persistance
    this.send_message = send_message
    this.position_sizer = position_sizer
    this.interim_spot_positions_metadata_persistant_storage = interim_spot_positions_metadata_persistant_storage
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

  private get_exchange_identifier(): ExchangeIdentifier_V3 {
    return this.ee.get_exchange_identifier()
  }

  /* Open both does [eventually] the order execution/tracking, sizing, and maintains redis */

  async open_position(args: {
    quote_asset: string
    base_asset: string
    direction: string
    edge: string
  }): Promise<{
    executed_quote_quantity: string
    stop_order_id: string | number
    executed_price: BigNumber
    stop_price: BigNumber
  }> {
    var edge_percentage_stop

    switch (args.edge) {
      case "edge60":
        edge_percentage_stop = new BigNumber(7)
        break

      default:
        this.send_message(`Only edge60 permitted at the moment`)
        throw new Error(`Only edge60 permitted at the moment`)
        break
    }

    /**
     * TODO: Make this trading rules instead
     */

    /**
     * Check if already in a position
     */
    if (await this.in_position(args)) {
      let msg = `Already in position on ${args.base_asset}`
      this.send_message(msg)
      throw new Error(msg)
    }

    /**
     * Get the position size, -- this can be hardcoded, just needs price or to specify quote amount to spend
     * Try and execute a buy on that position size
     * Create sell order at the stop price for any amount that was executed for the buy
     */

    this.send_message(`Opening Spot position in ${args.base_asset} using ${args.quote_asset}, edge ${args.edge}`)

    let quote_amount = await this.position_sizer.position_size_in_quote_asset(args)
    let cmd: SpotMarketBuyByQuoteQuantityCommand = {
      market_identifier: this.get_market_identifier_for(args),
      quote_amount,
    }
    let buy_result = await this.ee.market_buy_by_quote_quantity(cmd)
    let { executed_quote_quantity, executed_price, executed_base_quantity } = buy_result

    let stop_price_factor = new BigNumber(100).minus(edge_percentage_stop).div(100)
    let stop_price = executed_price.times(stop_price_factor)
    this.logger.info(
      `Calculated stop price of ${stop_price.toFixed()} given buy executed price of ${executed_price.toFixed()}`
    )

    let stop_cmd: SpotStopMarketSellCommand = {
      market_identifier: cmd.market_identifier,
      base_amount: executed_base_quantity,
      trigger_price: stop_price,
    }
    let stop_result = await this.ee.stop_market_sell(stop_cmd)
    let { order_id } = stop_result
    stop_price = stop_result.stop_price
    let spot_position_identifier: SpotPositionIdentifier = {
      exchange_identifier: this.get_exchange_identifier(),
      base_asset: args.base_asset,
    }
    await this.interim_spot_positions_metadata_persistant_storage.set_stop_order_id(
      spot_position_identifier,
      order_id.toString()
    )

    return {
      executed_quote_quantity: executed_quote_quantity.toFixed(),
      stop_order_id: order_id,
      executed_price,
      stop_price,
    }
  }

  /* Close both does [eventually] the order execution/tracking, and maintains redis */
  async close_position({
    quote_asset,
    base_asset,
    direction,
    edge,
  }: {
    quote_asset: string
    base_asset: string
    direction: string
    edge: string
  }): Promise<boolean> {
    let prefix: string = `Closing ${edge}:${base_asset} spot position:`

    /**
     * 1. Get stop order id and cancel it
     * 2. market sell position
     */

    let spot_position_identifier: SpotPositionIdentifier = {
      exchange_identifier: this.get_exchange_identifier(),
      base_asset,
    }

    let symbol = this.ee.get_market_identifier_for({ quote_asset, base_asset }).symbol

    try {
      /** Cancel stop order if there is one */
      let stop_order_id: string | null =
        await this.interim_spot_positions_metadata_persistant_storage.get_stop_order_id(spot_position_identifier)

      if (stop_order_id) {
        this.send_message(`${prefix} cancelling stop order ${stop_order_id} on ${symbol}`)
        await this.ee.cancel_order({
          order_id: stop_order_id,
          symbol,
        })
      } else {
        let msg = `${prefix} No stop order found`
        this.logger.info(msg)
        this.send_message(msg)
      }
    } catch (error) {
      let msg = `Failed to cancel stop order on ${symbol} - was it cancelled manually?`
      this.logger.warn(msg)
      this.logger.warn(error)
      Sentry.captureException(error)
      this.send_message(msg)
    }

    // Continue even if the attempt to cancel the stop order fails

    try {
      /** Exit the position */
      let base_amount = await this.exisiting_position_size({ base_asset })
      await this.ee.market_sell({ symbol, base_amount }) // throws if it fails
      // let executed_amount = // .. actually we might not have this info immediately
      return true // success, really we just have this here to verify that every other code path throws
    } catch (error) {
      let msg = `Failed to exit position on ${symbol}`
      this.logger.warn(msg)
      this.logger.warn(error)
      Sentry.captureException(error)
      this.send_message(msg)
      throw error
    }
  }

  async open_positions() :Promise<SpotPositionIdentifier[]>{
    return await this.positions_persistance.list_open_positions()
  }

  async query_open_positions(pq: SpotPositionsQuery_V3):Promise<SpotPositionIdentifier[]> {
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
}
