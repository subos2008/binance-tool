import { Binance, QueryOrderResult } from "binance-api-node"
import { GenericOrder, OrdersGetter } from "../generic/orders-getter"

import { BigNumber } from "bignumber.js"
import { EEXIST } from "constants"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { fromBinanceQueryOrderResult } from "./spot-orders"
import { BinanceExchangeInfoGetter } from "../../../classes/exchanges/binance/exchange-info-getter"

export class BinanceOrdersGetter implements OrdersGetter {
  ee: Binance
  prices: { [symbol: string]: string } | null = null
  exchange_info_getter: BinanceExchangeInfoGetter

  constructor({ ee }: { ee: Binance }) {
    this.ee = ee
    this.exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
  }

  async get_open_orders_on_specific_market({ market_symbol }: { market_symbol: string }): Promise<GenericOrder[]> {
    let binance_orders: QueryOrderResult[] = await this.ee.openOrders({ symbol: market_symbol })
    let exchange_info = await this.exchange_info_getter.get_exchange_info()
    function mapper(order: QueryOrderResult): GenericOrder {
      return fromBinanceQueryOrderResult({
        exchange_info,
        query_order_result: order,
      })
    }
    return binance_orders.map(mapper)
  }
}
