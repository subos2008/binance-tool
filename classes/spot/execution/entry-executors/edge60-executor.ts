import { strict as assert } from "assert"

import Sentry from "../../../../lib/sentry"

import { Logger } from "../../../../interfaces/logger"
import { MarketIdentifier_V3 } from "../../../../events/shared/market-identifier"
import {
  OrderContext_V1,
  SpotExecutionEngine,
  SpotMarketBuyByQuoteQuantityCommand,
  SpotStopMarketSellCommand,
} from "../../exchanges/interfaces/spot-execution-engine"
import { SpotPositionsPersistance } from "../../persistence/interface/spot-positions-persistance"
import { SendMessageFunc } from "../../../../lib/telegram-v2"
import { PositionSizer } from "../../../../services/spot-trade-abstraction/fixed-position-sizer"
import BigNumber from "bignumber.js"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { AuthorisedEdgeType, check_edge, SpotPositionIdentifier_V3 } from "../../abstractions/position-identifier"
import { OrderId } from "../../persistence/interface/order-context-persistence"

/**
 * If this does the execution of spot position entry/exit
 *
 * It is a low level class intended to be used by the TAS
 *
 * If you want to open positions in a safe way protected by the trading rules, use the tas-client instead
 *
 * Note this is instantiated with a particular exchange, the exchange identifier is
 * fixed at instantiation
 */
export class Edge60SpotPositionsExecution {
  logger: Logger
  ee: SpotExecutionEngine
  send_message: SendMessageFunc
  position_sizer: PositionSizer
  positions_persistance: SpotPositionsPersistance

  constructor({
    logger,
    ee,
    positions_persistance,
    send_message,
    position_sizer,
  }: {
    logger: Logger
    ee: SpotExecutionEngine
    positions_persistance: SpotPositionsPersistance
    send_message: SendMessageFunc
    position_sizer: PositionSizer
  }) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
    this.positions_persistance = positions_persistance
    this.send_message = send_message
    this.position_sizer = position_sizer
  }

  in_position({ base_asset, edge }: { base_asset: string; edge: AuthorisedEdgeType }) {
    return this.positions_persistance.in_position({
      base_asset,
      exchange_identifier: this.ee.get_exchange_identifier(),
      edge,
    })
  }

  exisiting_position_size({ base_asset, edge }: { base_asset: string; edge: AuthorisedEdgeType }) {
    return this.positions_persistance.position_size({
      base_asset,
      exchange_identifier: this.ee.get_exchange_identifier(),
      edge,
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
    edge: AuthorisedEdgeType
  }): Promise<{
    executed_quote_quantity: string
    stop_order_id: string | number | undefined
    executed_price: BigNumber
    stop_price: BigNumber
  }> {
    var edge_percentage_stop

    args.edge = check_edge(args.edge)
    assert.equal(args.edge, "edge60")

    edge_percentage_stop = new BigNumber(8)

    /**
     * TODO: Make this trading rules instead
     */

    /**
     * Check if already in a position
     */
    if (await this.in_position(args)) {
      let msg = `Already in position on ${args.edge}:${args.base_asset}`
      this.send_message(msg)
      throw new Error(msg)
    }

    /**
     * Get the position size, -- this can be hardcoded, just needs price or to specify quote amount to spend
     * Try and execute a buy on that position size
     * Create sell order at the stop price for any amount that was executed for the buy
     */

    this.send_message(`Opening Spot position ${args.edge}:${args.base_asset} using ${args.quote_asset}`)

    let quote_amount = await this.position_sizer.position_size_in_quote_asset(args)
    let order_context: OrderContext_V1 = { edge: args.edge, object_type: "OrderContext", version: 1 }
    let cmd: SpotMarketBuyByQuoteQuantityCommand = {
      order_context,
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

    let stop_order_id: OrderId | undefined
    let stop_cmd: SpotStopMarketSellCommand = {
      order_context,
      market_identifier: cmd.market_identifier,
      base_amount: executed_base_quantity,
      trigger_price: stop_price,
    }
    try {
      let stop_result = await this.ee.stop_market_sell(stop_cmd)
      stop_order_id = stop_result.order_id
      stop_price = stop_result.stop_price
      let spot_position_identifier: SpotPositionIdentifier_V3 = {
        exchange_identifier: this.get_exchange_identifier(),
        base_asset: args.base_asset,
        edge: args.edge,
      }
      await this.positions_persistance.set_stop_order(spot_position_identifier, stop_order_id.toString())
    } catch (error) {
      Sentry.captureException(error)
      this.send_message(
        `Failed to create stop limit order for ${args.edge}:${args.base_asset} on ${
          stop_cmd.market_identifier.symbol
        } at ${stop_price.toFixed()}`
      )
      throw error
    }

    return {
      executed_quote_quantity: executed_quote_quantity.toFixed(),
      stop_order_id,
      executed_price,
      stop_price,
    }
  }
}
