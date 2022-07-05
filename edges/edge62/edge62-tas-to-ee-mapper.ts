import {
  TradeAbstractionOpenShortCommand,
} from "../../services/binance/futures/trade-abstraction/interfaces/short"
import { OrderContext_V2 } from "../../interfaces/orders/order-context"

import { BigNumber } from "bignumber.js"
import { BinanceFuturesExecutionEngine, LimitSellByQuoteQuantityWithTPandSLCommand } from "../../services/binance/futures/trade-abstraction/execution/execution_engines/binance-futures-execution-engine"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

let edge_percentage_stop = new BigNumber(7)
let edge_percentage_take_profit = new BigNumber(7)
// let edge_percentage_buy_limit = new BigNumber(0.5)
let edge_percentage_sell_limit = new BigNumber(0.5)

export async function map_tas_to_ee_cmd_short(args: {
  tas_cmd: TradeAbstractionOpenShortCommand
  ee: BinanceFuturesExecutionEngine
  order_context: OrderContext_V2
  trigger_price: BigNumber
  quote_amount: BigNumber
  quote_asset: string
}): Promise<LimitSellByQuoteQuantityWithTPandSLCommand> {
  let stop_price_factor = new BigNumber(100).plus(edge_percentage_stop).div(100)
  let stop_price = args.trigger_price.times(stop_price_factor)

  let take_profit_price_factor = new BigNumber(100).minus(edge_percentage_take_profit).div(100)
  let take_profit_price = args.trigger_price.times(take_profit_price_factor)

  let sell_limit_price_factor = new BigNumber(100).minus(edge_percentage_sell_limit).div(100)
  let sell_limit_price = args.trigger_price.times(sell_limit_price_factor)

  let { base_asset } = args.tas_cmd
  let { quote_asset } = args
  let market_identifier = await args.ee.get_market_identifier_for({ quote_asset, base_asset })

  let { order_context, quote_amount } = args
  let short_entry_cmd: LimitSellByQuoteQuantityWithTPandSLCommand = {
    // object_type: "LimitSellByQuoteQuantityWithTPandSLCommand",
    // version: 1,
    order_context,
    market_identifier,
    quote_amount,
    sell_limit_price,
    take_profit_price,
    stop_price,
  }

  return short_entry_cmd
}
