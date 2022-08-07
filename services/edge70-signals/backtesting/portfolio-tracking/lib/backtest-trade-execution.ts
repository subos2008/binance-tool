// Prevent type coercion
import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { OrderContextPersistence_V2 } from "../../../../../classes/persistent_state/interface/order-context-persistence"
import { SpotPositionsQuery } from "../../../../../classes/spot/abstractions/spot-positions-query"
import { ExchangeIdentifier_V3 } from "../../../../../events/shared/exchange-identifier"
import { MarketIdentifier_V5_with_base_asset } from "../../../../../events/shared/market-identifier"
import { ServiceLogger } from "../../../../../interfaces/logger"
import { OrderContext_V2 } from "../../../../../interfaces/orders/order-context"
import { PositionSizer } from "../../../../../interfaces/position-sizer"
import { GenericOrderData } from "../../../../../types/exchange_neutral/generic_order_data"
import { Edge70BacktestParameters } from "../../../interfaces/edge70-signal"
import { EdgeCandle } from "../../../interfaces/_internal"
import { BankOfBacktesting } from "../interfaces"
import { BacktesterSpotPostionsTracker } from "../positions-tracker"

export class BacktestTradeExecution {
  logger: ServiceLogger
  edge: "edge70" | "edge70-backtest"
  position_sizer: PositionSizer
  order_context_persistence: OrderContextPersistence_V2
  positions_tracker: BacktesterSpotPostionsTracker
  exchange_identifier: ExchangeIdentifier_V3
  quote_asset: string
  stops: { [base_asset: string]: BigNumber }
  stop_factor: BigNumber
  spot_positions_query: SpotPositionsQuery
  bank: BankOfBacktesting

  constructor({
    logger,
    edge,
    position_sizer,
    exchange_identifier,
    quote_asset,
    edge70_parameters,
    order_context_persistence,
    spot_positions_query,
    positions_tracker,
    bank,
  }: {
    logger: ServiceLogger
    edge: "edge70" | "edge70-backtest"
    edge70_parameters: Edge70BacktestParameters
    position_sizer: PositionSizer
    exchange_identifier: ExchangeIdentifier_V3
    quote_asset: string
    spot_positions_query: SpotPositionsQuery
    order_context_persistence: OrderContextPersistence_V2
    positions_tracker: BacktesterSpotPostionsTracker
    bank: BankOfBacktesting
  }) {
    this.logger = logger
    this.edge = edge
    this.position_sizer = position_sizer
    this.positions_tracker = positions_tracker
    this.exchange_identifier = exchange_identifier
    this.quote_asset = quote_asset
    this.order_context_persistence = order_context_persistence
    this.spot_positions_query = spot_positions_query
    this.bank = bank
    this.stops = {}
    this.stop_factor = new BigNumber(edge70_parameters.stop_factor)
  }

  async execute_buy(args: {
    signal_timestamp_ms: number
    signal_price: string
    market_identifier: MarketIdentifier_V5_with_base_asset
  }) {
    let { edge, exchange_identifier, quote_asset } = this
    let { market_identifier, signal_timestamp_ms, signal_price } = args
    let { symbol, base_asset } = market_identifier

    let order_id = `${symbol}-BUY-${signal_timestamp_ms}`
    let trade_id = order_id
    let order_context: OrderContext_V2 = { object_type: "OrderContext", version: 1, edge, trade_id }
    await this.order_context_persistence.set_order_context_for_order({
      exchange_identifier,
      order_id,
      order_context,
    })
    let position_size = await this.position_sizer.position_size_in_quote_asset({
      base_asset,
      quote_asset,
      edge,
      direction: "long",
    })

    position_size = this.bank.withdraw_cash(position_size)

    let totalQuoteTradeQuantity = position_size.toFixed()
    let totalBaseTradeQuantity = new BigNumber(totalQuoteTradeQuantity).dividedBy(signal_price).toFixed(8)
    let generic_order_data: GenericOrderData = {
      exchange_identifier,
      market_symbol: symbol,
      side: "BUY",
      baseAsset: base_asset,
      quoteAsset: quote_asset,
      orderType: "MARKET",
      orderTime: signal_timestamp_ms,
      averageExecutionPrice: signal_price,
      order_id,
      totalBaseTradeQuantity,
      totalQuoteTradeQuantity,
    }
    await this.positions_tracker.buy_order_filled({ generic_order_data })
  }

  async execute_sell(args: {
    signal_timestamp_ms: number
    signal_price: string
    market_identifier: MarketIdentifier_V5_with_base_asset
    base_amount: BigNumber
  }) {
    let { edge, exchange_identifier, quote_asset } = this
    let { market_identifier, signal_timestamp_ms, signal_price } = args
    let { symbol, base_asset } = market_identifier

    let totalBaseTradeQuantity = args.base_amount.toFixed()
    let totalQuoteTradeQuantity = args.base_amount.times(signal_price).toFixed(8)
    let order_id = `${symbol}-SELL-${signal_timestamp_ms}`
    let trade_id = order_id
    let order_context: OrderContext_V2 = { object_type: "OrderContext", version: 1, edge, trade_id }
    await this.order_context_persistence.set_order_context_for_order({
      exchange_identifier,
      order_id,
      order_context,
    })
    let generic_order_data: GenericOrderData = {
      exchange_identifier,
      market_symbol: symbol,
      side: "SELL",
      baseAsset: base_asset,
      quoteAsset: quote_asset,
      orderType: "MARKET",
      orderTime: signal_timestamp_ms,
      averageExecutionPrice: signal_price,
      order_id,
      totalBaseTradeQuantity,
      totalQuoteTradeQuantity,
    }
    this.bank.pay_in_cash(new BigNumber(totalQuoteTradeQuantity))
    await this.positions_tracker.sell_order_filled({ generic_order_data })
    this.add_stop({ market_identifier, signal_price })
  }

  add_stop({
    market_identifier,
    signal_price,
  }: {
    market_identifier: MarketIdentifier_V5_with_base_asset
    signal_price: string
  }) {
    let { base_asset } = market_identifier
    this.stops[base_asset] = new BigNumber(signal_price).times(this.stop_factor).dp(8)
    this.logger.info(`${base_asset} Set stop of ${this.stops[base_asset].toFixed()}`)
  }

  /* check for stops */
  async ingest_new_candle({
    candle,
    market_identifier,
  }: {
    market_identifier: MarketIdentifier_V5_with_base_asset
    candle: EdgeCandle
  }): Promise<void> {
    let { edge } = this
    let { base_asset } = market_identifier
    if (await this.spot_positions_query.in_position({ edge, base_asset })) {
      let stop_price = this.stops[base_asset]
      if (new BigNumber(candle.low).isLessThanOrEqualTo(stop_price)) {
        let signal_timestamp_ms = candle.closeTime
        let signal_price = stop_price.toFixed()
        let base_amount: BigNumber = await this.spot_positions_query.exisiting_position_size({ edge, base_asset })
        this.logger.info(
          `HIT STOP ${base_asset} at price ${stop_price.toFixed()} - amount: ${base_amount.toFixed()}`
        )
        await this.execute_sell({ signal_timestamp_ms, signal_price, market_identifier, base_amount })
        delete this.stops[base_asset]
        if (!(await this.positions_tracker.in_position({ edge, base_asset })))
          throw new Error(`Still in ${base_asset} position after execute_sell`)
      }
    }
  }
}
