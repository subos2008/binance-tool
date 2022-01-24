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
  }): Promise<{ executed_quote_quantity: string }> {
    if (args.edge !== "edge60") {
      this.send_message(`Only edge60 permitted at the moment`)
      throw new Error(`Only edge60 permitted at the moment`)
    }

    /**
     * Check if already in a position
     */
    if (await this.in_position(args)) {
      let msg = `Already in position on ${args.base_asset}`
      this.send_message(msg)
      throw new Error(msg)
    }

    this.send_message(`Opening Spot position in ${args.base_asset} using ${args.quote_asset}, edge ${args.edge}`)

    let quote_amount = await this.position_sizer.position_size_in_quote_asset(args)
    let cmd: SpotMarketBuyByQuoteQuantityCommand = {
      market_identifier: this.get_market_identifier_for(args),
      quote_amount,
    }
    let buy_result = await this.ee.market_buy_by_quote_quantity(cmd)
    let { executed_quote_quantity, executed_price, executed_base_quantity } = buy_result

    const edge_percentage_stop = new BigNumber(7)
    let stop_price_factor = new BigNumber(100).minus(edge_percentage_stop).div(100)
    let stop_price = executed_price.times(stop_price_factor)

    let stop_cmd: SpotStopMarketSellCommand = {
      market_identifier: cmd.market_identifier,
      base_amount: executed_base_quantity,
      trigger_price: stop_price,
    }
    let stop_result = await this.ee.stop_market_sell(stop_cmd)
    let { order_id } = stop_result
    let spot_position_identifier: SpotPositionIdentifier = {
      exchange_identifier: this.get_exchange_identifier(),
      base_asset: args.base_asset,
    }
    this.interim_spot_positions_metadata_persistant_storage.set_stop_order_id(
      spot_position_identifier,
      order_id.toString()
    )

    return { executed_quote_quantity: executed_quote_quantity.toFixed() }

    /**
     * Get the position size, -- this can be hardcoded, just needs price or to specify quote amount to spend
     * Try and execute a buy on that position size
     * Create sell order at the stop price for any amount that was executed for the buy
     */
  }

  /* Close both does [eventually] the order execution/tracking, and maintains redis */
  close_position({
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
    this.send_message(`Closing Spot position in ${base_asset} from ${quote_asset}, edge ${edge} [NOT IMPLEMENTED]`)
  }

  async open_positions() {
    return this.positions_persistance.open_positions()
  }
}
