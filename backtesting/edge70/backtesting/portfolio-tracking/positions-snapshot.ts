#!./node_modules/.bin/ts-node

import BigNumber from "bignumber.js"
import { BinanceExchangeInfoGetter } from "../../../../classes/exchanges/binance/exchange-info-getter"
BigNumber.DEBUG = true // Prevent NaN
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { SpotPosition, SpotPositionObject_V2 } from "../../../../classes/spot/abstractions/spot-position"
import { SpotPositionsQuery } from "../../../../classes/spot/abstractions/spot-positions-query"
import { ExchangeInfoGetter } from "../../../../interfaces/exchanges/binance/exchange-info-getter"
import { CurrentAllPricesGetter } from "../../../../interfaces/exchanges/generic/price-getter"
import { ServiceLogger } from "../../../../interfaces/logger"
import { Prices } from "../../../../interfaces/portfolio"

export interface PositionWithQuoteValue {
  symbol: string
  base_asset: string
  quote_asset: string
  quote_value: BigNumber
}

export class PositionsSnapshot {
  private logger: ServiceLogger
  private spot_positions_query: SpotPositionsQuery
  private prices_getter: CurrentAllPricesGetter
  private prices: Prices | undefined
  positions: SpotPositionObject_V2[] = []
  private exchange_info_getter: ExchangeInfoGetter

  constructor({
    logger,
    spot_positions_query,
    prices_getter,
    exchange_info_getter,
  }: {
    logger: ServiceLogger
    spot_positions_query: SpotPositionsQuery
    prices_getter: CurrentAllPricesGetter
    exchange_info_getter: ExchangeInfoGetter
  }) {
    this.prices_getter = prices_getter
    this.logger = logger
    this.spot_positions_query = spot_positions_query
    this.exchange_info_getter = exchange_info_getter
  }

  /* aka init() */
  async take_snapshot() {
    this.prices = await this.prices_getter.prices()

    let open_positions: SpotPosition[] = []
    let open_position_identifiers = await this.spot_positions_query.open_positions()

    /** convert pi's to positions */
    for (const position_identifier of open_position_identifiers) {
      let p: SpotPosition = await this.spot_positions_query.position(position_identifier)
      open_positions.push(p)
    }

    /** convert positions's to immutable SpotPositionObject's */
    for (const position of open_positions) {
      let p = await position.describe_position()
      this.positions.push(p)
      if (p.position_size.isZero()) {
        throw new Error(`Positions with size 0 in PositionsSnapshot`)
      }
    }

    let msg = this.positions.map((p) => `${p.base_asset}: ${p.position_size}`).join(", ")
    this.logger.event({}, { object_type: `PositionsSnapshot`, msg: `[${msg}]` })
  }

  async get_positions_quote_values(args: { quote_asset: string }): Promise<PositionWithQuoteValue[]> {
    let { quote_asset } = args
    if (!this.prices) throw new Error(`this.prices not initialised, did you call .init()?`)
    let positions: PositionWithQuoteValue[] = []
    for (const p of this.positions) {
      let base_asset = p.base_asset
      let symbol = await this.exchange_info_getter.to_symbol({ base_asset, quote_asset })
      if (!symbol) throw new Error(`No symbol for ${base_asset}:${quote_asset}`)
      let current_price = this.prices[symbol]
      let quote_value = new BigNumber(current_price).times(p.position_size)
      positions.push({ quote_value, symbol, base_asset, quote_asset })
    }
    return positions
  }

  async get_total_value_in_quote_asset(args: { quote_asset: string }): Promise<BigNumber> {
    let { quote_asset } = args
    if (!this.prices) throw new Error(`this.prices not initialised, did you call .init()?`)
    let total_value = new BigNumber(0)
    for (const p of this.positions) {
      let base_asset = p.base_asset
      let symbol = await this.exchange_info_getter.to_symbol({ base_asset, quote_asset })
      if (!symbol) throw new Error(`No symbol for ${base_asset}:${quote_asset}`)
      let current_price = this.prices[symbol]
      let value = new BigNumber(current_price).times(p.position_size)
      total_value = total_value.plus(value)
    }
    return total_value
  }
}
