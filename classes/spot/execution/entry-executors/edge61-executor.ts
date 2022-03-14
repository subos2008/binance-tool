import { strict as assert } from "assert"

import Sentry from "../../../../lib/sentry"
import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../../../interfaces/logger"
import { MarketIdentifier_V3 } from "../../../../events/shared/market-identifier"
import {
  OrderContext_V1,
  SpotExecutionEngine,
  SpotLimitBuyCommand,
  SpotOCOSellCommand,
} from "../../exchanges/interfaces/spot-execution-engine"
import { SpotPositionsPersistance } from "../../persistence/interface/spot-positions-persistance"
import { SendMessageFunc } from "../../../../lib/telegram-v2"
import { PositionSizer } from "../../../../services/spot-trade-abstraction/fixed-position-sizer"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { AuthorisedEdgeType, check_edge, SpotPositionIdentifier_V3 } from "../../abstractions/position-identifier"
import { OrderId } from "../../persistence/interface/order-context-persistence"
import { CurrentPriceGetter } from "../../../../interfaces/exchange/generic/price-getter"
import { SpotPositionExecutionOpenResult } from "../spot-positions-execution"

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
export class Edge61SpotPositionsExecution {
  logger: Logger
  ee: SpotExecutionEngine
  send_message: SendMessageFunc
  position_sizer: PositionSizer
  positions_persistance: SpotPositionsPersistance
  price_getter: CurrentPriceGetter

  constructor({
    logger,
    ee,
    positions_persistance,
    send_message,
    position_sizer,
    price_getter,
  }: {
    logger: Logger
    ee: SpotExecutionEngine
    positions_persistance: SpotPositionsPersistance
    send_message: SendMessageFunc
    position_sizer: PositionSizer
    price_getter: CurrentPriceGetter
  }) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
    this.positions_persistance = positions_persistance
    this.send_message = send_message
    this.position_sizer = position_sizer
    this.price_getter = price_getter
  }

  // Used when constructing orders
  private get_market_identifier_for(args: { quote_asset: string; base_asset: string }): MarketIdentifier_V3 {
    return this.ee.get_market_identifier_for(args)
  }

  private get_exchange_identifier(): ExchangeIdentifier_V3 {
    return this.ee.get_exchange_identifier()
  }

  /* Open both does [eventually] the order execution/tracking, sizing, and maintains redis */
  // {
  //     executed_quote_quantity: string
  //     executed_base_quantity: string
  //     stop_order_id: string | number | undefined
  //     take_profit_order_id: string | number | undefined
  //     oco_order_id: string | number | undefined
  //     executed_price: BigNumber
  //     stop_price: BigNumber
  //     take_profit_price: BigNumber
  //   }
  async open_position(args: {
    quote_asset: string
    base_asset: string
    direction: string
    edge: AuthorisedEdgeType
    trigger_price?: BigNumber
  }): Promise<SpotPositionExecutionOpenResult> {
    try {
      args.edge = check_edge(args.edge)
      assert.equal(args.edge, "edge61")

      let { trigger_price, edge, base_asset, quote_asset } = args

      let edge_percentage_stop = new BigNumber(5)
      let edge_percentage_stop_limit = new BigNumber(15)
      let edge_percentage_take_profit = new BigNumber(5)
      let edge_percentage_buy_limit = new BigNumber(0.5)

      this.send_message(`Opening Spot position ${edge}:${args.base_asset} using ${args.quote_asset}`)

      let market_identifier: MarketIdentifier_V3 = this.get_market_identifier_for(args)
      if (!trigger_price) {
        this.logger.warn(`Using current price as trigger_price for ${args.edge}:${args.base_asset} entry`)
        trigger_price = await this.price_getter.get_current_price({ market_symbol: market_identifier.symbol })
      }
      /**
       * TODO: trading rules
       */

      let quote_amount = await this.position_sizer.position_size_in_quote_asset(args)
      let order_context: OrderContext_V1 = { edge, object_type: "OrderContext", version: 1 }
      let limit_price_factor = new BigNumber(100).plus(edge_percentage_buy_limit).div(100)
      let limit_price = trigger_price.times(limit_price_factor)
      this.logger.info(
        `Calculated buy_limit price of ${limit_price.toFixed()} given trigger_price of ${trigger_price.toFixed()} (${edge_percentage_buy_limit.toFixed()}%)`
      )
      let base_amount = quote_amount.dividedBy(limit_price)
      let cmd: SpotLimitBuyCommand = {
        order_context,
        market_identifier,
        base_amount,
        limit_price,
        order_type: "ioc",
      }
      let buy_result = await this.ee.limit_buy(cmd)
      let { executed_quote_quantity, executed_price, executed_base_quantity } = buy_result

      if (executed_base_quantity.isZero()) {
        let msg = `${edge}:${args.base_asset} IOC limit buy executed zero`
        this.logger.info(msg)
        throw new Error(msg)
      }

      let stop_price_factor = new BigNumber(100).minus(edge_percentage_stop).div(100)
      let stop_price = trigger_price.times(stop_price_factor)
      let stop_limit_price_factor = new BigNumber(100).minus(edge_percentage_stop_limit).div(100)
      let stop_limit_price = trigger_price.times(stop_limit_price_factor)
      this.logger.info(
        `Calculated stop price of ${stop_price.toFixed()} given trigger price of ${trigger_price.toFixed()}`
      )

      let take_profit_price_factor = new BigNumber(100).plus(edge_percentage_take_profit).div(100)
      let take_profit_price = trigger_price.times(take_profit_price_factor)
      this.logger.info(
        `Calculated take profit price of ${take_profit_price.toFixed()} given trigger price of ${trigger_price.toFixed()}`
      )

      let { clientOrderId: stop_ClientOrderId } = await this.ee.store_order_context_and_generate_clientOrderId(
        cmd.order_context
      )
      let { clientOrderId: take_profit_ClientOrderId } =
        await this.ee.store_order_context_and_generate_clientOrderId(cmd.order_context)
      let { clientOrderId: oco_list_ClientOrderId } = await this.ee.store_order_context_and_generate_clientOrderId(
        cmd.order_context
      )
      let spot_position_identifier: SpotPositionIdentifier_V3 = {
        exchange_identifier: this.get_exchange_identifier(),
        base_asset: args.base_asset,
        edge,
      }
      await this.positions_persistance.set_oco_order(spot_position_identifier, oco_list_ClientOrderId)

      let oco_cmd: SpotOCOSellCommand = {
        order_context,
        market_identifier: cmd.market_identifier,
        base_amount: executed_base_quantity,
        stop_price,
        stop_limit_price,
        take_profit_price,
        stop_ClientOrderId,
        take_profit_ClientOrderId,
        oco_list_ClientOrderId,
      }

      try {
        let oco_result = await this.ee.oco_sell_order(oco_cmd)
      } catch (error) {
        Sentry.captureException(error)
        this.send_message(
          `Failed to create oco order for ${edge}:${args.base_asset} on ${
            oco_cmd.market_identifier.symbol
          } at ${stop_price.toFixed()}`
        )
        throw error
      }

      return {
        base_asset,
        quote_asset,
        edge,
        executed_quote_quantity: executed_quote_quantity.toFixed(),
        executed_base_quantity: executed_base_quantity.toFixed(),
        oco_order_id: oco_list_ClientOrderId,
        stop_order_id: stop_ClientOrderId,
        take_profit_order_id: take_profit_ClientOrderId,
        executed_price: executed_price.toFixed(),
        stop_price: stop_price.toFixed(),
        take_profit_price: take_profit_price.toFixed(),
      }
    } catch (error) {
      Sentry.captureException(error)
      throw error
    }
  }
}
