import BigNumber from "bignumber.js";
import { TradeDefinition } from "./trade_definition";

export class PriceRanges {
  percentage_before_soft_buy_price_to_add_order: BigNumber

  constructor({ trade_definition, percentage_before_soft_buy_price_to_add_order }:
    {
      trade_definition: TradeDefinition,
      percentage_before_soft_buy_price_to_add_order?: BigNumber | undefined
    }) {
    this.percentage_before_soft_buy_price_to_add_order = percentage_before_soft_buy_price_to_add_order || new BigNumber('0.5')
    console.info(`PriceRanges should refresh with exchange_info`)
  }
}
