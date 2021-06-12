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

export type PositionObject = {
  initial_entry_timestamp: number
  position_size: BigNumber
  initial_quote_invested: BigNumber
  initial_entry_quote_asset: string
  initial_entry_price: BigNumber
}

export class Position {
  logger: Logger
  send_message: Function | undefined
  ee: any
  redis_positions: RedisPositionsState
  position_identifier: PositionIdentifier

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

  get baseAsset(): string {
    return this.position_identifier.baseAsset
  }

  async initial_entry_price(): Promise<BigNumber> {
    return this.redis_positions.get_initial_entry_price(this.position_identifier)
  }

  async initial_entry_quote_asset(): Promise<string> {
    return this.redis_positions.get_initial_entry_quote_asset(this.position_identifier)
  }

  async position_size(): Promise<BigNumber> {
    return this.redis_positions.get_position_size(this.position_identifier)
  }

  async describe_position(): Promise<PositionObject> {
    return this.redis_positions.describe_position(this.position_identifier)
  }

  // Create a new position in the state
  // NB: does not send a NewPosition event as that would require AQMP access,
  // We could take that as an argument. Or there are RO vs RW versions of this class
  async create({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    if (this.send_message) this.send_message(`New position for ${generic_order_data.baseAsset}`)
    this.redis_positions.create_new_position(this.position_identifier, {
      position_size: new BigNumber(generic_order_data.totalBaseTradeQuantity),
      initial_entry_price: new BigNumber(generic_order_data.averageExecutionPrice),
      initial_quote_invested: new BigNumber(generic_order_data.totalQuoteTradeQuantity),
      initial_entry_quote_asset: generic_order_data.quoteAsset,
      initial_entry_timestamp: generic_order_data.orderTime,
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
      await this.redis_positions.adjust_position_size_by(this.position_identifier, {
        base_change,
      })
      // TODO: Fire a position changed event
    }
  }

  async close() {
    this.redis_positions.close_position(this.position_identifier)
  }
}
