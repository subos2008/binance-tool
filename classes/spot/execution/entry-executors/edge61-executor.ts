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
  SpotMarketSellCommand,
  SpotOCOSellCommand,
} from "../../exchanges/interfaces/spot-execution-engine"
import { SpotPositionsPersistance } from "../../persistence/interface/spot-positions-persistance"
import { SendMessageFunc } from "../../../../lib/telegram-v2"
import { PositionSizer } from "../../../../services/spot-trade-abstraction/fixed-position-sizer"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { AuthorisedEdgeType, check_edge, SpotPositionIdentifier_V3 } from "../../abstractions/position-identifier"
import { OrderId } from "../../persistence/interface/order-context-persistence"
import { CurrentPriceGetter } from "../../../../interfaces/exchange/generic/price-getter"
import {
  TradeAbstractionOpenSpotLongCommand,
  TradeAbstractionOpenSpotLongResult,
} from "../../../../services/spot-trade-abstraction/trade-abstraction-service"

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
  async open_position(args: TradeAbstractionOpenSpotLongCommand): Promise<TradeAbstractionOpenSpotLongResult> {
    try {
      args.edge = check_edge(args.edge)
      assert.equal(args.edge, "edge61")
      let { trigger_price: trigger_price_string, edge, base_asset, quote_asset } = args

      if (!quote_asset) throw new Error(`quote_asset not defined`)

      let edge_percentage_stop = new BigNumber(5)
      let edge_percentage_stop_limit = new BigNumber(15)
      let edge_percentage_take_profit = new BigNumber(5)
      let edge_percentage_buy_limit = new BigNumber(0.5)

      this.logger.object({ object_type: "SpotPositionExecutionOpenRequest", ...args })

      let market_identifier: MarketIdentifier_V3 = this.get_market_identifier_for({ ...args, quote_asset })
      let trigger_price: BigNumber | undefined
      if (trigger_price_string) {
        trigger_price = new BigNumber(trigger_price_string)
      } else {
        this.logger.warn(`Using current price as trigger_price for ${args.edge}:${args.base_asset} entry`)
        trigger_price = await this.price_getter.get_current_price({ market_symbol: market_identifier.symbol })
      }
      /**
       * TODO: trading rules
       */

      let quote_amount = await this.position_sizer.position_size_in_quote_asset({ ...args, quote_asset })
      let order_context: OrderContext_V1 = { edge, object_type: "OrderContext", version: 1 }
      let limit_price_factor = new BigNumber(100).plus(edge_percentage_buy_limit).div(100)
      let limit_price = trigger_price.times(limit_price_factor)
      this.logger.info(
        `Calculated buy_limit price of ${limit_price.toFixed()} given trigger_price of ${trigger_price} (${edge_percentage_buy_limit.toFixed()}%)`
      )
      let base_amount = quote_amount.dividedBy(limit_price)
      let cmd: SpotLimitBuyCommand = {
        object_type: "SpotLimitBuyCommand",
        order_context,
        market_identifier,
        base_amount,
        limit_price,
        timeInForce: "IOC",
      }
      let buy_result = await this.ee.limit_buy(cmd)
      let { executed_quote_quantity, executed_price, executed_base_quantity, execution_timestamp_ms } = buy_result

      if (executed_base_quantity.isZero()) {
        let msg = `${edge}:${args.base_asset} IOC limit buy executed zero, looks like we weren't fast enough to catch this one (${edge_percentage_buy_limit}% slip limit)`
        this.logger.info(msg)
        // this.send_message(msg, { edge, base_asset })
        let ret: TradeAbstractionOpenSpotLongResult = {
          object_type: "TradeAbstractionOpenSpotLongResult",
          version: 1,
          edge,
          base_asset,
          quote_asset,
          status: "ENTRY_FAILED_TO_FILL",
          execution_timestamp_ms,
        }
        this.logger.object(ret)
        return ret
      } else {
        let msg = `${edge}:${
          args.base_asset
        } bought ${executed_quote_quantity.toFixed()} ${quote_asset} worth.  Entry slippage allowed ${edge_percentage_buy_limit}%, target buy was ${quote_amount.toFixed()}`
        this.logger.info(msg)
        // this.send_message(msg, { edge, base_asset })
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
        object_type: "SpotOCOSellCommand",
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
        this.logger.warn(error)
        Sentry.captureException(error)

        /** If we failed to create the OCO order then dump the position */
        this.logger.warn({ edge, base_asset }, `Failed to create OCO order, dumping position`)
        let market_sell_cmd: SpotMarketSellCommand = {
          order_context,
          market_identifier,
          base_amount: executed_base_quantity,
        }
        await this.ee.market_sell(market_sell_cmd)

        let ret: TradeAbstractionOpenSpotLongResult = {
          object_type: "TradeAbstractionOpenSpotLongResult",
          version: 1,
          status: "ABORTED_FAILED_TO_CREATE_EXIT_ORDERS",
          edge,
          base_asset,
          quote_asset,
          executed_base_quantity: "0",
          executed_quote_quantity: "0",
          created_stop_order: false,
          created_take_profit_order: false,
        }
        this.logger.object(ret)
        return ret
      }

      let res: TradeAbstractionOpenSpotLongResult = {
        object_type: "TradeAbstractionOpenSpotLongResult",
        version: 1,
        base_asset,
        quote_asset,
        edge,
        executed_quote_quantity: executed_quote_quantity.toFixed(),
        executed_base_quantity: executed_base_quantity.toFixed(),
        oco_order_id: oco_list_ClientOrderId,
        created_stop_order: true,
        stop_order_id: stop_ClientOrderId,
        created_take_profit_order: true,
        take_profit_order_id: take_profit_ClientOrderId,
        executed_price: executed_price.toFixed(),
        stop_price: stop_price.toFixed(),
        take_profit_price: take_profit_price.toFixed(),
        status: "SUCCESS",
        execution_timestamp_ms,
      }
      this.logger.object(res)
      return res
    } catch (error) {
      Sentry.captureException(error)
      this.logger.error({ err: error })
      this.send_message(`FAILED opening spot position ${args.edge}:${args.base_asset} using ${args.quote_asset}`, {
        edge: args.edge,
        base_asset: args.base_asset,
      })

      throw error
    }
  }
}
