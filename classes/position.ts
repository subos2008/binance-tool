/* Realtime Presumably Redis backed access to Position data, loading and mutation thereof
 * Direct access to the Redis state exists in other classes atm and we are trying to move it all here
 */

import { Logger } from "../interfaces/logger"
import { RedisPositionsState } from "../classes/persistent_state/redis_positions_state"
import { PositionIdentifier } from "../events/shared/position-identifier"

import { BigNumber } from "bignumber.js"
import { GenericOrderData } from "../types/exchange_neutral/generic_order_data"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export class Position {
  logger: Logger
  send_message: Function | undefined
  ee: any
  redis_positions: RedisPositionsState
  position_identifier: PositionIdentifier
  object: any | undefined

  constructor({
    logger,
    send_message,
    redis_positions,
    position_identifier,
  }: {
    logger: Logger
    send_message?: Function
    redis_positions: RedisPositionsState
    position_identifier: PositionIdentifier
  }) {
    this.logger = logger
    this.send_message = send_message
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

  get baseAsset(): string {
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

  // Create a new position in the state
  // NB: does not send a NewPosition event as that would require AQMP access,
  // We could take that as an argument. Or there are RO vs RW versions of this class
  async create({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    if(this.send_message) this.send_message(`New position for ${generic_order_data.baseAsset}`)
    let initial_entry_price = generic_order_data.averageExecutionPrice
      ? new BigNumber(generic_order_data.averageExecutionPrice)
      : undefined
    this.redis_positions.create_new_position(this.tuple, {
      position_size: new BigNumber(generic_order_data.totalBaseTradeQuantity),
      initial_entry_price,
      quote_invested: new BigNumber(generic_order_data.totalQuoteTradeQuantity),
    })
  }

  // adjust the position according to the order, or create a new position if current size is zero
  async add_order_to_position({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let {
      baseAsset,
      side,
      // quoteAsset,
      exchange,
      account,
      // averageExecutionPrice,
      totalBaseTradeQuantity,
      // totalQuoteTradeQuantity, // TODO: use this
    } = generic_order_data
    if (!account) account = "default" // TODO
    if (baseAsset !== this.baseAsset) {
      throw new Error(`Unexpected base_asset in call to Position.add_order_to_position`)
    }
    if ((await this.position_size()).isZero()) {
      this.create({ generic_order_data })
    } else {
      let base_change =
        side === "BUY" ? new BigNumber(totalBaseTradeQuantity) : new BigNumber(totalBaseTradeQuantity).negated()
      await this.redis_positions.adjust_position_size_by(
        { baseAsset, exchange, account },
        {
          base_change,
        }
      )
      // TODO: Fire a position changed event
    }
  }

  async close() {
    // TODO: maybe do USD equiv?
    // let msg = `${position.baseAsset} traded from ${position.initial_entry_price} to ${
    //   position.current_price
    // }: ${position.percentage_price_change_since_initial_entry?.dp(1)}% change.`
    // this.send_message(msg)
    this.redis_positions.close_position(this.tuple)
  }
}
