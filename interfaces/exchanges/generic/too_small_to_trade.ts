import BigNumber from "bignumber.js"
import { ExchangeInfoGetter } from "../binance/exchange-info-getter";

export interface TooSmallToTrade {
  is_too_small_to_trade({
    price,
    volume,
    symbol,
    exchange_info_getter
  }: {
    exchange_info_getter: ExchangeInfoGetter
    symbol: string
    price: BigNumber
    volume: BigNumber
  }): Promise<boolean>
}
