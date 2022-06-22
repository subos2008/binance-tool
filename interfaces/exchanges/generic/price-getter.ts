import { BigNumber } from "bignumber.js"
import { BinanceStyleSpotPrices } from "../../../classes/spot/abstractions/position-identifier";

export interface CurrentPriceGetter {
  get_current_price({ market_symbol }: { market_symbol: string }): Promise<BigNumber>
}

export interface CurrentAllPricesGetter {
  prices(): Promise<BinanceStyleSpotPrices>
}
