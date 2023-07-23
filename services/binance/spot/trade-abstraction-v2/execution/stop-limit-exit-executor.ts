import { strict as assert } from "assert"

import Sentry from "../../../../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger, ServiceLogger } from "../../../../../interfaces/logger"
import {
  MarketIdentifier_V4,
  MarketIdentifier_V5_with_base_asset,
} from "../../../../../events/shared/market-identifier"
import { SpotPositionsPersistence } from "../../../../../classes/spot/persistence/interface/spot-positions-persistance"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../../../events/shared/exchange-identifier"
import {
  AuthorisedEdgeType,
  SpotPositionIdentifier_V3,
} from "../../../../../classes/spot/abstractions/position-identifier"
import { OrderId } from "../../../../../classes/persistent_state/interface/order-context-persistence"
import { TradeAbstractionOpenLongCommand_StopLimitExit, TradeAbstractionOpenLongResult } from "../interfaces/long"
import {
  SpotMarketSellCommand,
  SpotStopMarketSellCommand,
  TradeContext,
} from "../../../../../interfaces/exchanges/spot-execution-engine"
import { OrderContext_V1 } from "../../../../../interfaces/orders/order-context"
import { CurrentPriceGetter } from "../../../../../interfaces/exchanges/generic/price-getter"
import { SpotPositionsExecution_BuyLimit } from "./buy-limit-executor"
import { BinanceSpotExecutionEngine } from "./execution_engines/binance-spot-execution-engine"
import { SendMessageFunc } from "../../../../../interfaces/send-message"
import { PositionSizer } from "../../../../../interfaces/position-sizer"

/* Edge specific code */
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
export class SpotPositionsExecution_StopLimitExit {
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
  private get_market_identifier_for(args: {
    quote_asset: string
    base_asset: string
  }): MarketIdentifier_V5_with_base_asset {
    return this.ee.get_market_identifier_for(args)
  }

  private get_exchange_identifier(): ExchangeIdentifier_V4 {
    return this.ee.get_exchange_identifier()
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

  /* Open both does [eventually] the order execution/tracking, sizing, and maintains redis */
  // TODO: there is no wrapping exception (500) on this function - if it throws it will throw!
  async open_position(
    args: TradeAbstractionOpenLongCommand_StopLimitExit
  ): Promise<TradeAbstractionOpenLongResult> {
    let { trigger_price: trigger_price_string, edge, base_asset, quote_asset, trade_id } = args
    let { edge_percentage_stop, edge_percentage_buy_limit } = args
    let tags = { edge, base_asset, quote_asset, trade_id }

    this.logger.command(tags, args, "received")

    let prefix = `${edge}:${base_asset} open spot long: `

    let market_identifier: MarketIdentifier_V5_with_base_asset = this.get_market_identifier_for({
      ...args,
      quote_asset,
    })
    let trigger_price: BigNumber
    if (trigger_price_string) {
      trigger_price = new BigNumber(trigger_price_string)
    } else {
      this.logger.warn(tags, `Using current price as trigger_price for ${args.edge}:${args.base_asset} entry`)
      trigger_price = await this.price_getter.get_current_price({ market_symbol: market_identifier.symbol })
    }

    /**
     * TODO: trading rules
     */

    let trade_context: TradeContext = { base_asset, quote_asset, edge, trade_id }

    let buy_result: TradeAbstractionOpenLongResult = await this.limit_buy_executor.buy_limit_entry(args)

    if (buy_result.status !== "SUCCESS") {
      return buy_result
    }

    let { execution_timestamp_ms } = buy_result
    let executed_price: BigNumber = new BigNumber(buy_result.executed_price)
    let executed_base_quantity: BigNumber = new BigNumber(buy_result.executed_base_quantity)
    let executed_quote_quantity: BigNumber = new BigNumber(buy_result.executed_quote_quantity)

    /** BUY completed  */

    let order_context: OrderContext_V1 = { edge, object_type: "OrderContext", version: 1 }

    let stop_price_factor = new BigNumber(100).minus(edge_percentage_stop).div(100)
    let stop_price = executed_price.times(stop_price_factor)

    let stop_order_id: OrderId | undefined
    let stop_cmd: SpotStopMarketSellCommand = {
      object_type: "SpotStopMarketSellCommand",
      object_class: "command",
      order_context,
      market_identifier,
      trade_context,
      base_amount: executed_base_quantity,
      trigger_price: stop_price,
    }
    this.logger.command(tags, stop_cmd, "created")

    try {
      this.logger.todo(
        { level: "warn", ...tags },
        `e60: can throw instead of returning enum status result. it also won't exit (dump the position) if the stop creation fails`
      )

      let stop_result = await this.ee.stop_market_sell(stop_cmd)
      stop_order_id = stop_result.order_id
      stop_price = stop_result.stop_price
      let spot_position_identifier: SpotPositionIdentifier_V3 = {
        exchange_identifier: this.get_exchange_identifier(),
        base_asset: args.base_asset,
        edge: args.edge,
      }
      await this.positions_persistance.set_stop_order(spot_position_identifier, stop_order_id.toString())
      await this.positions_persistance.set_stop_price(spot_position_identifier, stop_price)
    } catch (err) {
      Sentry.captureException(err)
      let msg = `Failed to create stop limit order for ${args.edge}:${args.base_asset} on ${
        stop_cmd.market_identifier.symbol
      } at ${stop_price.toFixed()}`
      this.logger.exception(tags, err)
      this.send_message(msg, tags)
      this.logger.error(tags, "ERROR: this position has no stop and will not be dumped")
      // TODO: are there any 429s on this dump of position?
      this.logger.error(tags, `Failed to create OCO order, dumping position`)
      let market_sell_cmd: SpotMarketSellCommand = {
        order_context,
        market_identifier,
        base_amount: executed_base_quantity,
      }

      // TODO: this could throw. Where is our logic if the dump fails? fatal message, record fail in return
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
      executed_quote_quantity: executed_quote_quantity.toFixed(),
      executed_base_quantity: executed_base_quantity.toFixed(),
      stop_order_id,
      executed_price: executed_price.toFixed(),
      stop_price: stop_price.toFixed(),
      status: "SUCCESS",
      http_status: 201,
      msg: `${prefix}: SUCCESS`,
      execution_timestamp_ms,
      created_take_profit_order: false,
      created_stop_order: true,
    }
    this.logger.result(tags, spot_long_result, "created")
    return spot_long_result
  }
}
