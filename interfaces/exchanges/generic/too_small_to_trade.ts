import BigNumber from "bignumber.js"

export interface TooSmallToTrade {
  is_too_small_to_trade({
    price,
    volume,
    symbol,
  }: {
    symbol: string
    price: BigNumber
    volume: BigNumber
  }): Promise<boolean>
}
