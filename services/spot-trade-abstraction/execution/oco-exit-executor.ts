import { strict as assert } from "assert"

import Sentry from "../../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../../interfaces/logger"
import { MarketIdentifier_V3 } from "../../../events/shared/market-identifier"
import { SpotPositionsPersistance } from "../../../classes/spot/persistence/interface/spot-positions-persistance"
import { SendMessageFunc } from "../../../lib/telegram-v2"
import { PositionSizer } from "../fixed-position-sizer"
import { ExchangeIdentifier_V3 } from "../../../events/shared/exchange-identifier"
import {
  SpotPositionIdentifier_V3,
} from "../../../classes/spot/abstractions/position-identifier"
import {
  TradeAbstractionOpenSpotLongCommand_OCO_Exit,
  TradeAbstractionOpenSpotLongResult,
} from "../interfaces/open_spot"

/* Edge specific code */
import { CurrentPriceGetter } from "../../../interfaces/exchanges/generic/price-getter"
import { SpotExecutionEngine, SpotLimitBuyCommand, SpotMarketSellCommand, SpotOCOSellCommand } from "../../../interfaces/exchanges/spot-execution-engine"
import { OrderContext_V1 } from "../../../interfaces/orders/order-context"

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

  async open_position(
    args: TradeAbstractionOpenSpotLongCommand_OCO_Exit
  ): Promise<TradeAbstractionOpenSpotLongResult> {
    try {
      let { trigger_price: trigger_price_string, edge, base_asset, quote_asset } = args

      let {
        edge_percentage_stop,
        edge_percentage_stop_limit,
        edge_percentage_take_profit,
        edge_percentage_buy_limit,
      } = args

      let prefix = `${edge}:${base_asset} open spot long: `
      let tags = { edge, base_asset, quote_asset }

      let market_identifier: MarketIdentifier_V3 = this.get_market_identifier_for({ ...args, quote_asset })
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

      let quote_amount = await this.position_sizer.position_size_in_quote_asset({ ...args, quote_asset })
      let order_context: OrderContext_V1 = { edge, object_type: "OrderContext", version: 1 }
      let limit_price_factor = new BigNumber(100).plus(edge_percentage_buy_limit).div(100)
      let limit_price = trigger_price.times(limit_price_factor)
      let base_amount = quote_amount.dividedBy(limit_price)

      this.logger.info(tags, {
        object_type: "SpotPositionExecutionOpenRequest",
        ...args,
        buy_limit_price: limit_price,
        quote_amount,
        base_amount,
      })

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
        this.logger.info(tags, msg)
        // this.send_message(msg, { edge, base_asset })
        let ret: TradeAbstractionOpenSpotLongResult = {
          object_type: "TradeAbstractionOpenSpotLongResult",
          version: 1,
          edge,
          base_asset,
          quote_asset,
          status: "ENTRY_FAILED_TO_FILL",
          msg: `${prefix}: ENTRY_FAILED_TO_FILL`,
          execution_timestamp_ms,
        }
        this.logger.info(tags, ret)
        return ret
      } else {
        let msg = `${edge}:${
          args.base_asset
        } bought ${executed_quote_quantity.toFixed()} ${quote_asset} worth.  Entry slippage allowed ${edge_percentage_buy_limit}%, target buy was ${quote_amount.toFixed()}`
        this.logger.info(tags, msg)
        // this.send_message(msg, { edge, base_asset })
      }

      /** BUY completed  */

      let stop_price_factor = new BigNumber(100).minus(edge_percentage_stop).div(100)
      let stop_price = trigger_price.times(stop_price_factor)
      let stop_limit_price_factor = new BigNumber(100).minus(edge_percentage_stop_limit).div(100)
      let stop_limit_price = trigger_price.times(stop_limit_price_factor)

      let take_profit_price_factor = new BigNumber(100).plus(edge_percentage_take_profit).div(100)
      let take_profit_price = trigger_price.times(take_profit_price_factor)

      this.logger.info(tags, {
        object_type: "SpotPositionExecutionCreateOCOExitOrderRequest",
        ...args,
        buy_limit_price: limit_price,
        quote_amount,
        base_amount,
        stop_price,
        take_profit_price,
        stop_limit_price,
      })

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
      this.logger.info(tags, oco_cmd)

      try {
        let oco_result = await this.ee.oco_sell_order(oco_cmd)
      } catch (err) {
        this.logger.warn(tags, { err })
        Sentry.captureException(err)

        /** If we failed to create the OCO order then dump the position */
        this.logger.warn(tags, `Failed to create OCO order, dumping position`)
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
          msg: `${prefix}: ABORTED_FAILED_TO_CREATE_EXIT_ORDERS`,
          edge,
          base_asset,
          quote_asset,
          executed_base_quantity: "0",
          executed_quote_quantity: "0",
          created_stop_order: false,
          created_take_profit_order: false,
        }
        this.logger.info(tags, ret)
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
        msg: `${prefix}: SUCCESS`,
        execution_timestamp_ms,
      }
      this.logger.object(res)
      return res
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err })
      this.send_message(`FAILED opening spot position ${args.edge}:${args.base_asset} using ${args.quote_asset}`, {
        edge: args.edge,
        base_asset: args.base_asset,
      })

      throw err
    }
  }
}
