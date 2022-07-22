import { strict as assert } from "assert"

import Sentry from "../../../../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../../../../interfaces/logger"
import { MarketIdentifier_V4 } from "../../../../../events/shared/market-identifier"
import { SpotPositionsPersistance } from "../../../../../classes/spot/persistence/interface/spot-positions-persistance"
import { SendMessageFunc } from "../../../../../classes/send_message/publish"
import { ExchangeIdentifier_V3 } from "../../../../../events/shared/exchange-identifier"
import {
  TradeAbstractionOpenLongCommand_OCO_Exit,
  TradeAbstractionOpenLongCommand_StopLimitExit,
  TradeAbstractionOpenLongResult,
  TradeAbstractionOpenSpotLongResult_TOO_MANY_REQUESTS,
} from "../interfaces/long"
import { SendDatadogMetrics } from "./send-datadog-metrics"

/* Edge specific code */
import { CurrentPriceGetter } from "../../../../../interfaces/exchanges/generic/price-getter"
import {
  SpotExecutionEngineBuyResult,
  // SpotExecutionEngineBuyResult,
  SpotLimitBuyCommand,
  TradeContext,
} from "../../../../../interfaces/exchanges/spot-execution-engine"
import { OrderContext_V1 } from "../../../../../interfaces/orders/order-context"
import { PositionSizer } from "../../../../../edges/position-sizer/fixed-position-sizer"
import { BinanceSpotExecutionEngine } from "./execution_engines/binance-spot-execution-engine"

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
export class SpotPositionsExecution_BuyLimit {
  logger: Logger
  ee: BinanceSpotExecutionEngine
  send_message: SendMessageFunc
  position_sizer: PositionSizer
  positions_persistance: SpotPositionsPersistance
  price_getter: CurrentPriceGetter
  metrics: SendDatadogMetrics

  constructor({
    logger,
    ee,
    positions_persistance,
    send_message,
    position_sizer,
    price_getter,
  }: {
    logger: Logger
    ee: BinanceSpotExecutionEngine
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
    let exchange_identifier = this.ee.get_exchange_identifier()
    this.metrics = new SendDatadogMetrics({ logger, exchange_identifier })
  }

  // Used when constructing orders
  private get_market_identifier_for(args: { quote_asset: string; base_asset: string }): MarketIdentifier_V4 {
    return this.ee.get_market_identifier_for(args)
  }

  async buy_limit_entry(
    args: TradeAbstractionOpenLongCommand_OCO_Exit | TradeAbstractionOpenLongCommand_StopLimitExit
  ): Promise<TradeAbstractionOpenLongResult> {
    let { trigger_price: trigger_price_string, edge, base_asset, quote_asset } = args
    let tags = { edge, base_asset, quote_asset }

    try {
      this.metrics.buy_limit_request(args)
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err })
    }

    let prefix = `${edge}:${base_asset} open spot long: `
    try {
      let { edge_percentage_buy_limit } = args

      let market_identifier: MarketIdentifier_V4 = this.get_market_identifier_for({ ...args, quote_asset })
      let trade_context: TradeContext = { base_asset, quote_asset, edge }
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
      let buy_limit_price = trigger_price.times(limit_price_factor)
      let base_amount = quote_amount.dividedBy(buy_limit_price)

      let cmd: SpotLimitBuyCommand = {
        object_type: "SpotLimitBuyCommand",
        order_context,
        market_identifier,
        base_amount,
        limit_price: buy_limit_price,
        timeInForce: "IOC",
      }

      let buy_result: SpotExecutionEngineBuyResult = await this.ee.limit_buy(cmd, trade_context)

      try {
        this.metrics.buy_limit_result(buy_result, { base_asset, quote_asset, edge })
      } catch (err) {
        Sentry.captureException(err)
        this.logger.error({ err })
      }

      if (buy_result.status !== "FILLED") {
        let result: TradeAbstractionOpenLongResult = {
          ...buy_result,
          object_type: "TradeAbstractionOpenLongResult",
          version: 1,
          edge,
          base_asset,
          quote_asset,
        }
        this.logger.warn(result)
        return result
      }

      let { executed_quote_quantity, executed_price, executed_base_quantity, execution_timestamp_ms } = buy_result

      let msg = `${edge}:${
        args.base_asset
      } bought ${executed_quote_quantity.toFixed()} ${quote_asset} worth.  Entry slippage allowed ${edge_percentage_buy_limit}%, target buy was ${quote_amount.toFixed()}`
      let spot_long_result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        version: 1,
        msg,
        edge,
        base_asset,
        quote_asset,
        executed_quote_quantity: executed_quote_quantity.toFixed(),
        executed_price: executed_price.toFixed(),
        executed_base_quantity: executed_base_quantity.toFixed(),
        status: "SUCCESS",
        http_status: 201,
        execution_timestamp_ms,
        created_stop_order: false,
        created_take_profit_order: false,
      }
      this.logger.info(spot_long_result)
      return spot_long_result
    } catch (err: any) {
      Sentry.captureException(err)
      this.logger.error({ err })
      let msg = `${prefix}: INTERNAL_SERVER_ERROR opening spot position using ${
        args.quote_asset
      }: ${err.toString()}`
      let spot_long_result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        version: 1,
        msg,
        err,
        edge,
        base_asset,
        quote_asset,
        status: "INTERNAL_SERVER_ERROR",
        http_status: 500,
        execution_timestamp_ms: Date.now(),
      }
      this.logger.error(spot_long_result)
      this.send_message(msg, {
        edge: args.edge,
        base_asset: args.base_asset,
      })

      return spot_long_result
    }
  }
}
