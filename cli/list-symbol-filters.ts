#!../node_modules/.bin/ts-node

import { ServiceLogger } from "../interfaces/logger"
import { BunyanServiceLogger } from "../lib/service-logger"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })

const BinanceFoo = require("binance-api-node").default
import { Binance } from "binance-api-node"
import { StaticBinanceAlgoUtils } from "../services/binance/spot/trade-abstraction-v2/execution/execution_engines/_internal/static-binance_algo_utils_v2"
import { BinanceExchangeInfoGetter } from "../classes/exchanges/binance/exchange-info-getter"
var ee: Binance
logger.info("Live monitoring mode")
ee = BinanceFoo({
  // apiKey: process.env.BINANCE_API_KEY,
  // apiSecret: process.env.BINANCE_API_SECRET,
  // getTime: xxx // time generator function, optional, defaults to () => Date.now()
})

async function main() {
  let exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
  let exchange_info = await exchange_info_getter.get_exchange_info()

  // let filters = algo_utils.

  let filters = StaticBinanceAlgoUtils.get_symbol_filters({ exchange_info, symbol: "BTCUSDT" })
  console.log(filters)

  let order_types = StaticBinanceAlgoUtils.get_symbol_order_types({ exchange_info, symbol: "BTCUSDT" })
  console.log(order_types)
}

main().catch((err) => console.error(err))
