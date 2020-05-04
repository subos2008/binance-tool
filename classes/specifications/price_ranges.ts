import BigNumber from "bignumber.js";
import { TradeDefinition } from "./trade_definition";
import { Logger } from "../../interfaces/logger";

export class PriceRanges {
  percentage_before_soft_buy_price_to_add_order: BigNumber
  trade_definition: TradeDefinition
  logger: Logger

  constructor({ logger, trade_definition, percentage_before_soft_buy_price_to_add_order }:
    {
      logger: Logger,
      trade_definition: TradeDefinition,
      percentage_before_soft_buy_price_to_add_order?: BigNumber | undefined
    }) {
    this.percentage_before_soft_buy_price_to_add_order = percentage_before_soft_buy_price_to_add_order || new BigNumber('0.5')
    this.trade_definition = trade_definition
    this.logger = logger
    this.logger.info(`PriceRanges should refresh with exchange_info`)
  }

  get soft_entry_buy_order_trigger_price() {
    if(!this.trade_definition.unmunged.buy_price) {
      throw new Error(`Asked for soft_entry_buy_order_trigger_price when this.trade_definition.unmunged.buy_price is not available`)
    }
    // NB: I copied this snippet into the test cases 
    return this.trade_definition.unmunged.buy_price.times(
      new BigNumber(100)
        .plus(this.percentage_before_soft_buy_price_to_add_order)
        .div(100)
    );
  }
}
