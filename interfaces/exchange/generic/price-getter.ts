import { BigNumber } from "bignumber.js"

export interface CurrentPriceGetter {
  get_current_price({ market_symbol }: { market_symbol: string }): Promise<BigNumber>
}
