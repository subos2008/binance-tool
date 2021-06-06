import { Logger } from "../interfaces/logger"
import { RedisPositionsState } from "../classes/persistent_state/redis_positions_state"
import { PositionIdentifier } from "../events/shared/position-identifier"

/*
{ exchange: 'binance', account: 'default', symbol: 'XTZBNB' }
{
  position_size: 783.8,
  initial_entry_price: 0.00988,
  netQuoteBalanceChange: -6.121648
}
*/

import { BigNumber } from "bignumber.js"
import { GenericOrderData } from "../types/exchange_neutral/generic_order_data"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export class Position {
  logger: Logger
  ee: any
  redis_positions: RedisPositionsState
  position_identifier: PositionIdentifier
  object: any | undefined
  prices: { [key: string]: string } = {}

  constructor({
    logger,
    redis_positions,
    position_identifier,
  }: {
    logger: Logger
    redis_positions: RedisPositionsState
    position_identifier: PositionIdentifier
  }) {
    this.logger = logger
    this.redis_positions = redis_positions
    this.position_identifier = position_identifier
  }

  get tuple() {
    return {
      baseAsset: this.baseAsset,
      exchange: this.position_identifier.exchange_identifier.exchange,
      account: this.position_identifier.exchange_identifier.account,
    }
  }

  get baseAsset(): string {
    return this.position_identifier.baseAsset
  }

  get initial_entry_price(): BigNumber | null {
    return new BigNumber(this.object?.initial_entry_price)
  }

  // TODO: avg entry price derived from netQuote change and position size?
  // then make sure netQuote change is tracked properly

  // Depricated, needs a quoteAsset to compare with
  // get current_price(): BigNumber | undefined {
  //   return this.prices[this.symbol] ? new BigNumber(this.prices[this.symbol]) : undefined
  // }

  // Depricated, needs a quoteAsset to compare with
  // get percentage_price_change_since_initial_entry(): BigNumber | undefined {
  //   if (!this.initial_entry_price) throw new Error(`initial_entry_price unknown`)
  //   if (!this.current_price) throw new Error(`current_price unknown`)
  //   return this.current_price.minus(this.initial_entry_price).dividedBy(this.initial_entry_price).times(100)
  // }

  async load_and_init({ prices }: { prices: { [key: string]: string } }) {
    this.prices = prices
    this.object = await this.describe_position()
  }

  async position_size(): Promise<BigNumber> {
    const object: any = this.redis_positions.describe_position(this.position_identifier)
    return object.position_size ? new BigNumber(object.position_size) : new BigNumber(0)
  }

  async describe_position(): Promise<{
    position_size: BigNumber | undefined
    initial_entry_price: BigNumber | undefined
    netQuoteBalanceChange: BigNumber | undefined
    current_price?: string
  }> {
    const object: any = this.redis_positions.describe_position(this.position_identifier)
    // if (this.prices) object.current_price = this.current_price
    return object
  }

  asObject(): string {
    return Object.assign({}, this.object, {
      // position_identifier: this.position_identifier,
      // current_price: this.current_price,
    })
  }

  // adjust the position according to the order
  async add_order_to_position({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let {
      baseAsset,
      // quoteAsset,
      exchange,
      account,
      // averageExecutionPrice,
      totalBaseTradeQuantity,
      // totalQuoteTradeQuantity, // TODO: use this
    } = generic_order_data
    if (!account) account = "default" // TODO
    await this.redis_positions.adjust_position_size_by(
      { baseAsset, exchange, account },
      {
        base_change: new BigNumber(totalBaseTradeQuantity).negated(),
      }
    )
  }
}
