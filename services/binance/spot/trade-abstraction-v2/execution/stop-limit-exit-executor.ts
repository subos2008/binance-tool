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
import { SendMessageFunc } from "../../../../../lib/telegram-v2"
import { ExchangeIdentifier_V3 } from "../../../../../events/shared/exchange-identifier"
import {
  AuthorisedEdgeType,
  SpotPositionIdentifier_V3,
} from "../../../../../classes/spot/abstractions/position-identifier"
import { OrderId } from "../../../../../classes/persistent_state/interface/order-context-persistence"
import {
  TradeAbstractionOpenSpotLongCommand__StopLimitExit,
  TradeAbstractionOpenLongResult,
} from "../interfaces/long"
import {
  SpotExecutionEngine,
  SpotLimitBuyCommand,
  SpotStopMarketSellCommand,
} from "../../../../../interfaces/exchanges/spot-execution-engine"
import { OrderContext_V1 } from "../../../../../interfaces/orders/order-context"
import { CurrentPriceGetter } from "../../../../../interfaces/exchanges/generic/price-getter"
import { SpotPositionsExecution_BuyLimit } from "./buy-limit-executor"
import { PositionSizer } from "../../../../../edges/position-sizer/fixed-position-sizer"

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
  logger: Logger
  ee: SpotExecutionEngine
  send_message: SendMessageFunc
  position_sizer: PositionSizer
  positions_persistance: SpotPositionsPersistance
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
  private get_market_identifier_for(args: { quote_asset: string; base_asset: string }): MarketIdentifier_V4 {
    return this.ee.get_market_identifier_for(args)
  }

  private get_exchange_identifier(): ExchangeIdentifier_V3 {
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

  async open_position(
    args: TradeAbstractionOpenSpotLongCommand__StopLimitExit
  ): Promise<TradeAbstractionOpenLongResult> {
    let { trigger_price: trigger_price_string, edge, base_asset, quote_asset } = args
    let { edge_percentage_stop, edge_percentage_buy_limit } = args
    let tags = { edge, base_asset, quote_asset }

    this.logger.info(tags, { object_type: "SpotPositionExecutionOpenRequest", ...args })

    let prefix = `${edge}:${base_asset} open spot long: `

    let market_identifier: MarketIdentifier_V4 = this.get_market_identifier_for({ ...args, quote_asset })
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
      order_context,
      market_identifier,
      base_amount: executed_base_quantity,
      trigger_price: stop_price,
    }
    this.logger.info(tags, stop_cmd)

    try {
      let stop_result = await this.ee.stop_market_sell(stop_cmd)
      stop_order_id = stop_result.order_id
      stop_price = stop_result.stop_price
      let spot_position_identifier: SpotPositionIdentifier_V3 = {
        exchange_identifier: this.get_exchange_identifier(),
        base_asset: args.base_asset,
        edge: args.edge,
      }
      this.logger.warn(
        tags,
        `e60: can throw instead of returning enum status result. it also won't exit if the stop creation fails`
      )
      await this.positions_persistance.set_stop_order(spot_position_identifier, stop_order_id.toString())
    } catch (err) {
      Sentry.captureException(err)
      let msg = `Failed to create stop limit order for ${args.edge}:${args.base_asset} on ${
        stop_cmd.market_identifier.symbol
      } at ${stop_price.toFixed()}`
      this.send_message(msg, tags)
      this.logger.error(tags, { err })
      this.logger.error(tags, "ERROR: this position has no stop and will not be dumped")
      // TODO: this should dump the position
      throw err
    }

    let spot_long_result: TradeAbstractionOpenLongResult = {
      object_type: "TradeAbstractionOpenLongResult",
      version: 1,
      base_asset,
      quote_asset,
      edge,
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
    this.logger.info(spot_long_result)
    return spot_long_result
  }
}
