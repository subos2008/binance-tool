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
import {
  OrderContext_V1,
  SpotExecutionEngine,
  SpotLimitBuyCommand,
} from "../../../classes/spot/exchanges/interfaces/spot-execution-engine"
import { SpotPositionsPersistance } from "../../../classes/spot/persistence/interface/spot-positions-persistance"
import { SendMessageFunc } from "../../../lib/telegram-v2"
import { PositionSizer } from "../fixed-position-sizer"
import { ExchangeIdentifier_V3 } from "../../../events/shared/exchange-identifier"
import {
  AuthorisedEdgeType,
  check_edge,
  SpotPositionIdentifier_V3,
} from "../../../classes/spot/abstractions/position-identifier"
import { OrderId } from "../../../classes/spot/persistence/interface/order-context-persistence"
import {
  TradeAbstractionOpenSpotLongCommand,
  TradeAbstractionOpenSpotLongCommand_Edge60,
  TradeAbstractionOpenSpotLongResult,
} from "../interfaces/open_spot"

/* Edge specific code */
import {
  SpotMarketBuyByQuoteQuantityCommand,
  SpotStopMarketSellCommand,
} from "../../../classes/spot/exchanges/interfaces/spot-execution-engine"
import { CurrentPriceGetter } from "../../../interfaces/exchange/generic/price-getter"
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
export class Edge60SpotPositionsExecution {
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
    args: TradeAbstractionOpenSpotLongCommand_Edge60
  ): Promise<TradeAbstractionOpenSpotLongResult> {
    let { trigger_price: trigger_price_string, edge, base_asset, quote_asset } = args
    let { edge_percentage_stop, edge_percentage_buy_limit } = args
    let tags = { edge, base_asset, quote_asset }

    this.logger.info(tags, { object_type: "SpotPositionExecutionOpenRequest", ...args })

    let prefix = `${edge}:${base_asset} open spot long: `

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
      // let msg = `${edge}:${args.base_asset} IOC limit buy executed zero, looks like we weren't fast enough to catch this one (${edge_percentage_buy_limit}% slip limit)`
      // this.logger.info(tags, msg)
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
      this.logger.object(tags, ret)
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
    let stop_price = executed_price.times(stop_price_factor)

    this.logger.object(tags, {
      object_type: "SpotPositionExecutionCreateStopExitOrderRequest",
      ...args,
      buy_limit_price: limit_price,
      quote_amount,
      base_amount,
      stop_price,
    })

    let stop_order_id: OrderId | undefined
    let stop_cmd: SpotStopMarketSellCommand = {
      object_type: "SpotStopMarketSellCommand",
      order_context,
      market_identifier: cmd.market_identifier,
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
      await this.positions_persistance.set_stop_order(spot_position_identifier, stop_order_id.toString())
      this.logger.warn(tags, `e60: can throw instead of returning enum status result`)
    } catch (err) {
      Sentry.captureException(err)
      let msg = `Failed to create stop limit order for ${args.edge}:${args.base_asset} on ${
        stop_cmd.market_identifier.symbol
      } at ${stop_price.toFixed()}`
      this.send_message(msg, tags)
      this.logger.error(tags)
      throw err
    }

    let res: TradeAbstractionOpenSpotLongResult = {
      object_type: "TradeAbstractionOpenSpotLongResult",
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
      msg: `${prefix}: SUCCESS`,
      execution_timestamp_ms,
      created_take_profit_order: false,
      created_stop_order: true,
    }
    this.logger.info(res)
    return res
  }
}
