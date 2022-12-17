import { strict as assert } from "assert"

import Sentry from "../../../../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { ServiceLogger } from "../../../../../interfaces/logger"
import { MarketIdentifier_V4, MarketIdentifier_V5, MarketIdentifier_V5_with_base_asset } from "../../../../../events/shared/market-identifier"
import { SpotPositionsPersistence } from "../../../../../classes/spot/persistence/interface/spot-positions-persistance"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../../../events/shared/exchange-identifier"
import { SpotPositionIdentifier_V3 } from "../../../../../classes/spot/abstractions/position-identifier"
import { TradeAbstractionOpenLongCommand_OCO_Exit, TradeAbstractionOpenLongResult } from "../interfaces/long"

/* Edge specific code */
import { CurrentPriceGetter } from "../../../../../interfaces/exchanges/generic/price-getter"
import {
  SpotMarketSellCommand,
  SpotOCOSellCommand,
} from "../../../../../interfaces/exchanges/spot-execution-engine"
import { OrderContext_V1, OrderContext_V2 } from "../../../../../interfaces/orders/order-context"
import { SpotPositionsExecution_BuyLimit } from "./buy-limit-executor"
import { BinanceSpotExecutionEngine } from "./execution_engines/binance-spot-execution-engine"
import { SendMessageFunc, TradeContextTags } from "../../../../../interfaces/send-message"
import { PositionSizer } from "../../../../../interfaces/position-sizer"

/* END Edge specific code */

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
export class SpotPositionsExecution_OCOExit {
  logger: ServiceLogger
  ee: BinanceSpotExecutionEngine
  send_message: SendMessageFunc
  position_sizer: PositionSizer
  positions_persistance: SpotPositionsPersistence
  price_getter: CurrentPriceGetter
  limit_buy_executor: SpotPositionsExecution_BuyLimit

  constructor({
    logger,
    ee,
    positions_persistance,
    send_message,
    position_sizer,
    price_getter,
  }: {
    logger: ServiceLogger
    ee: BinanceSpotExecutionEngine
    positions_persistance: SpotPositionsPersistence
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
    this.limit_buy_executor = new SpotPositionsExecution_BuyLimit({
      logger,
      ee,
      positions_persistance,
      send_message,
      position_sizer,
      price_getter,
    })
  }

  // Used when constructing orders
  private get_market_identifier_for(args: { quote_asset: string; base_asset: string }): MarketIdentifier_V5_with_base_asset {
    return this.ee.get_market_identifier_for(args)
  }

  private get_exchange_identifier(): ExchangeIdentifier_V4 {
    return this.ee.get_exchange_identifier()
  }

  async open_position(args: TradeAbstractionOpenLongCommand_OCO_Exit): Promise<TradeAbstractionOpenLongResult> {
    let { trigger_price: trigger_price_string, edge, base_asset, quote_asset, trade_id } = args
    let tags: TradeContextTags = { edge, base_asset, quote_asset, trade_id }
    try {
      let { edge_percentage_stop, edge_percentage_stop_limit, edge_percentage_take_profit } = args

      let prefix = `${edge}:${base_asset} open spot long: `

      let market_identifier: MarketIdentifier_V5_with_base_asset = this.get_market_identifier_for({ ...args, quote_asset })
      let trigger_price: BigNumber | undefined
      if (trigger_price_string) {
        trigger_price = new BigNumber(trigger_price_string)
      } else {
        this.logger.warn(tags, `Using current price as trigger_price for ${args.edge}:${args.base_asset} entry`)
        trigger_price = await this.price_getter.get_current_price({ market_symbol: market_identifier.symbol })
      }

      /**
       * TODO: trading rules
       */

      let buy_result: TradeAbstractionOpenLongResult = await this.limit_buy_executor.buy_limit_entry(args)

      if (buy_result.status !== "SUCCESS") {
        return buy_result
      }

      let { executed_base_quantity, executed_quote_quantity, executed_price, execution_timestamp_ms } = buy_result

      /** ENTRY completed  */

      let order_context: OrderContext_V2 = { edge, object_type: "OrderContext", version: 1, trade_id }
      let stop_price_factor = new BigNumber(100).minus(edge_percentage_stop).div(100)
      let stop_price = trigger_price.times(stop_price_factor)
      let stop_limit_price_factor = new BigNumber(100).minus(edge_percentage_stop_limit).div(100)
      let stop_limit_price = trigger_price.times(stop_limit_price_factor)

      let take_profit_price_factor = new BigNumber(100).plus(edge_percentage_take_profit).div(100)
      let take_profit_price = trigger_price.times(take_profit_price_factor)

      let { clientOrderId: stop_ClientOrderId } = await this.ee.store_order_context_and_generate_clientOrderId(
        order_context
      )
      let { clientOrderId: take_profit_ClientOrderId } =
        await this.ee.store_order_context_and_generate_clientOrderId(order_context)
      let { clientOrderId: oco_list_ClientOrderId } = await this.ee.store_order_context_and_generate_clientOrderId(
        order_context
      )
      let spot_position_identifier: SpotPositionIdentifier_V3 = {
        exchange_identifier: this.get_exchange_identifier(),
        base_asset: args.base_asset,
        edge,
      }
      await this.positions_persistance.set_oco_order(spot_position_identifier, oco_list_ClientOrderId)

      let base_amount = new BigNumber(executed_base_quantity)

      let oco_cmd: SpotOCOSellCommand = {
        object_type: "SpotOCOSellCommand",
        object_class: "command",
        order_context,
        market_identifier,
        base_amount,
        stop_price,
        stop_limit_price,
        take_profit_price,
        stop_ClientOrderId,
        take_profit_ClientOrderId,
        oco_list_ClientOrderId,
      }
      this.logger.command(tags, oco_cmd, "created")

      try {
        let oco_result = await this.ee.oco_sell_order(oco_cmd)
      } catch (err) {
        this.logger.exception(tags, err)

        /** If we failed to create the OCO order then dump the position */
        // TODO: if this is because the price has gone up we could create a trailing stop instead
        this.logger.error(tags, `Failed to create OCO order, dumping position`)
        let market_sell_cmd: SpotMarketSellCommand = {
          order_context,
          market_identifier,
          base_amount,
        }
        await this.ee.market_sell(market_sell_cmd)

        let spot_long_result: TradeAbstractionOpenLongResult = {
          object_type: "TradeAbstractionOpenLongResult",
          object_class: "result",
          version: 1,
          status: "ABORTED_FAILED_TO_CREATE_EXIT_ORDERS",
          http_status: 200,
          msg: `${prefix}: ABORTED_FAILED_TO_CREATE_EXIT_ORDERS`,
          edge,
          trade_id,
          base_asset,
          quote_asset,
          executed_base_quantity: "0",
          executed_quote_quantity: "0",
          created_stop_order: false,
          created_take_profit_order: false,
        }
        this.logger.todo(
          { ...tags, level: "warn" },
          `ABORTED_FAILED_TO_CREATE_EXIT_ORDERS doesn't record if position was dumped`
        )
        this.logger.result({ ...tags, level: "warn" }, spot_long_result, "created")
        return spot_long_result
      }

      let spot_long_result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        object_class: "result",
        version: 1,
        base_asset,
        quote_asset,
        edge,
        trade_id,
        executed_quote_quantity,
        executed_base_quantity,
        oco_order_id: oco_list_ClientOrderId,
        created_stop_order: true,
        stop_order_id: stop_ClientOrderId,
        created_take_profit_order: true,
        take_profit_order_id: take_profit_ClientOrderId,
        executed_price,
        stop_price: stop_price.toFixed(), // TODO: these are unmunged
        take_profit_price: take_profit_price.toFixed(),
        status: "SUCCESS",
        http_status: 201,
        msg: `${prefix}: SUCCESS`,
        execution_timestamp_ms,
      }
      this.logger.result(tags, spot_long_result, "created")
      return spot_long_result
    } catch (err: any) {
      let spot_long_result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        object_class: "result",
        version: 1,
        base_asset,
        edge,
        trade_id,
        status: "INTERNAL_SERVER_ERROR",
        http_status: 500,
        msg: `INTERNAL_SERVER_ERROR: ${err.message}`,
        err,
        execution_timestamp_ms: Date.now(),
      }
      this.logger.result({ ...tags, level: "error" }, spot_long_result, "created")
      Sentry.captureException(err)
      this.logger.exception(tags, err)
      this.send_message(
        `FAILED opening spot position ${args.edge}:${args.base_asset} using ${args.quote_asset}`,
        tags
      )
      return spot_long_result
    }
  }
}
