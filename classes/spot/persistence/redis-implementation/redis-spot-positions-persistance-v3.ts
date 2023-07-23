/**
 * A less clunky version of the low level RedisSpotPositionsState
 *
 * This originally bridged the new interface to the old redis positions state (some thunky hacks)
 *
 * Now it bridges just the old to new interface - it basically exists to implement
 * a new interface, the low level class it wraps can be folded in at some stage
 */

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { SpotPositionsPersistence, SpotPositionInitialisationData } from "../interface/spot-positions-persistance"

import { Logger } from "../../../../interfaces/logger"

import { RedisSpotPositionsState } from "./low-level/redis-spot-positions-state-v3"
import { RedisClientType } from "redis-v4"
import { SpotPositionIdentifier_V3 } from "../../abstractions/position-identifier"
import { SpotPositionObject } from "../../abstractions/spot-position"
import { GenericOrderData } from "../../../../types/exchange_neutral/generic_order_data"
import { OrderId } from "../../../persistent_state/interface/order-context-persistence"

export class RedisSpotPositionsPersistence implements SpotPositionsPersistence {
  logger: Logger
  state: RedisSpotPositionsState

  constructor({ logger, redis }: { logger: Logger; redis: RedisClientType }) {
    this.logger = logger
    this.state = new RedisSpotPositionsState({ logger, redis })
  }

  async initialise_position(
    pi: SpotPositionIdentifier_V3,
    position_initialisation_data: SpotPositionInitialisationData
  ): Promise<void> {
    await this.state.create_new_position(pi, position_initialisation_data)
  }

  async delete_position(pi: SpotPositionIdentifier_V3): Promise<void> {
    await this.state.delete_position(pi)
  }

  async in_position(pi: SpotPositionIdentifier_V3): Promise<boolean> {
    return (await this.position_size(pi)).isGreaterThan(0)
  }

  async position_size(pi: SpotPositionIdentifier_V3): Promise<BigNumber> {
    return this.state.get_position_size(pi)
  }

  async initial_entry_price(pi: SpotPositionIdentifier_V3): Promise<BigNumber> {
    return this.state.get_initial_entry_price(pi)
  }

  async initial_entry_quote_asset(pi: SpotPositionIdentifier_V3): Promise<string> {
    return this.state.get_initial_entry_quote_asset(pi)
  }

  async initial_entry_timestamp_ms(pi: SpotPositionIdentifier_V3): Promise<number> {
    return this.state.get_initial_entry_timestamp(pi)
  }

  async edge(pi: SpotPositionIdentifier_V3): Promise<string> {
    return this.state.get_edge(pi)
  }

  async as_spot_position_object(pi: SpotPositionIdentifier_V3): Promise<SpotPositionObject> {
    return this.state.describe_position(pi)
  }

  async list_open_positions(): Promise<SpotPositionIdentifier_V3[]> {
    let pis: SpotPositionIdentifier_V3[] = await this.state.open_positions()
    return pis
  }

  async adjust_position_size_by(
    pi: SpotPositionIdentifier_V3,
    { base_change }: { base_change: BigNumber }
  ): Promise<void> {
    return this.state.adjust_position_size_by(pi, { base_change })
  }

  /** this means filled orders that we should use to update the position state/info */
  async add_orders(pi: SpotPositionIdentifier_V3, orders: GenericOrderData[]): Promise<number> {
    return this.state.add_orders(pi, orders)
  }

  async orders(pi: SpotPositionIdentifier_V3): Promise<GenericOrderData[]> {
    return this.state.get_orders(pi)
  }

  /**
   * this is a bit hacky because we assume there is only one stop order,
   * edge60 wants to know what its stop order is when cancelling the order
   * so this is our not-over-architected way of storing an order_id that needs to be cancelled
   */
  async set_stop_order(pi: SpotPositionIdentifier_V3, order_id: OrderId): Promise<void> {
    return this.state.set_stop_order(pi, order_id)
  }
  async get_stop_order(pi: SpotPositionIdentifier_V3): Promise<OrderId | undefined> {
    return this.state.get_stop_order(pi)
  }
  async set_stop_price(pi: SpotPositionIdentifier_V3, stop_price: BigNumber): Promise<void> {
    return this.state.set_stop_price(pi, stop_price)
  }
  async get_stop_price(pi: SpotPositionIdentifier_V3): Promise<BigNumber | undefined> {
    return this.state.get_stop_price(pi)
  }
  async set_oco_order(pi: SpotPositionIdentifier_V3, order_id: OrderId): Promise<void> {
    return this.state.set_oco_order(pi, order_id)
  }
  async get_oco_order(pi: SpotPositionIdentifier_V3): Promise<OrderId | undefined> {
    return this.state.get_oco_order(pi)
  }
}
