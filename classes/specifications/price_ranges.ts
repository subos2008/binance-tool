import BigNumber from "bignumber.js";
import { TradeDefinition } from "./trade_definition";

export class PriceRanges {
  percentage_before_soft_buy_price_to_add_order: BigNumber
  trade_definition: TradeDefinition

  constructor({ trade_definition, percentage_before_soft_buy_price_to_add_order }:
    {
      trade_definition: TradeDefinition,
      percentage_before_soft_buy_price_to_add_order?: BigNumber | undefined
    }) {
    this.percentage_before_soft_buy_price_to_add_order = percentage_before_soft_buy_price_to_add_order || new BigNumber('0.5')
    this.trade_definition = trade_definition
    console.info(`PriceRanges should refresh with exchange_info`)
  }

  get soft_entry_buy_order_trigger_price() {
    if(!this.trade_definition.unmunged.buy_price) {
      throw new Error(`Asked for soft_entry_buy_order_trigger_price when this.trade_definition.unmunged.buy_price is not available`)
    }
    return this.trade_definition.unmunged.buy_price.times(
      new BigNumber(100)
        .plus(this.percentage_before_soft_buy_price_to_add_order)
        .div(100)
    );
  }
}
