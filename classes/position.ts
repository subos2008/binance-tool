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
      baseAsset: this.position_identifier.baseAsset,
      exchange: this.position_identifier.exchange_identifier.exchange,
      account: this.position_identifier.exchange_identifier.account,
    }
  }

  baseAsset(): string {
    return this.position_identifier.baseAsset
  }

  async initial_entry_price(): Promise<BigNumber | undefined> {
    let initial_entry_price = (await this.describe_position()).initial_entry_price
    return initial_entry_price ? new BigNumber(initial_entry_price) : undefined
  }

  async load_and_init() {
    this.object = await this.describe_position()
  }

  async position_size(): Promise<BigNumber> {
    const object: any = this.redis_positions.describe_position(this.position_identifier)
    return object.position_size ? new BigNumber(object.position_size) : new BigNumber(0)
  }

  async describe_position(): Promise<{
    position_size?: BigNumber
    initial_entry_price?: BigNumber
    netQuoteBalanceChange?: BigNumber
    current_price?: string
  }> {
    const object: any = this.redis_positions.describe_position(this.position_identifier)
    return object
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
