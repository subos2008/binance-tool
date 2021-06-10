// An object to pass around classes that handle generic exchange events to provide
// exchange specific services

import { BigNumber } from "bignumber.js"

export interface ExchangeUtils {
  // base_asset_for_market(symbol: string): string
  // quote_asset_for_market(symbol: string): string
  // is_too_small_to_trade({
  //   price,
  //   volume,
  //   market_symbol,
  // }: {
  //   market_symbol: string
  //   price: BigNumber
  //   volume: BigNumber
  // }): boolean
  get_prices(): Promise<{ [market_symbol: string]: string }>
}
