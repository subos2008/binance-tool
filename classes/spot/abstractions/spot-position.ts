/**
 * A wrapper class representing and allowing tweaks of a particular already open position
 *
 * Instantiate this class via SpotPositionsQuery, this ensures that the position actually
 * exists and isn't just a pointer to nothing
 *
 * TODO: probably this class should assert it is backed by data?
 * Or be declared inside spot-positions-query and not exported
 *
 */

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger, ServiceLogger } from "../../../interfaces/logger"
import { AuthorisedEdgeType, SpotPositionIdentifier_V3 } from "./position-identifier"
import { GenericOrderData } from "../../../types/exchange_neutral/generic_order_data"
import {
  genericOrderDataToSpotPositionInitialisationData,
  SpotPositionsPersistence,
} from "../persistence/interface/spot-positions-persistance"
import { SpotPositionClosed, SpotPositionOpenedEvent_V1 } from "./spot-position-callbacks"

export type SpotPositionObject = {
  initial_entry_timestamp: number
  position_size: BigNumber
  initial_quote_invested?: BigNumber
  initial_entry_quote_asset: string
  initial_entry_price?: BigNumber
  initial_entry_position_size: BigNumber
  orders: GenericOrderData[]
  edge: AuthorisedEdgeType
  stop_order_id?: string
}

export interface SpotPositionObject_V2 extends SpotPositionObject {
  base_asset: string
}
export interface SpotPositionObject_V2_with_quote_value extends SpotPositionObject_V2 {
  base_asset: string
  quote_asset: string
  quote_value: BigNumber
}

export class SpotPosition {
  private logger: Logger
  private send_message: Function | undefined
  private spot_positions_persistance: SpotPositionsPersistence
  position_identifier: SpotPositionIdentifier_V3

  constructor({
    logger,
    send_message,
    spot_positions_persistance,
    position_identifier,
  }: {
    logger: Logger | ServiceLogger
    send_message?: Function
    spot_positions_persistance: SpotPositionsPersistence
    position_identifier: SpotPositionIdentifier_V3
  }) {
    this.logger = logger
    this.send_message = send_message
    this.spot_positions_persistance = spot_positions_persistance
    this.position_identifier = position_identifier
  }

  get baseAsset(): string {
    return this.position_identifier.base_asset
  }

  get base_asset(): string {
    return this.position_identifier.base_asset
  }

  async initial_entry_price(): Promise<BigNumber> {
    return this.spot_positions_persistance.initial_entry_price(this.position_identifier)
  }

  async initial_entry_quote_asset(): Promise<string> {
    return this.spot_positions_persistance.initial_entry_quote_asset(this.position_identifier)
  }

  async initial_entry_timestamp_ms(): Promise<number> {
    return await this.spot_positions_persistance.initial_entry_timestamp_ms(this.position_identifier)
  }

  async position_size(): Promise<BigNumber> {
    return this.spot_positions_persistance.position_size(this.position_identifier)
  }

  async describe_position(): Promise<SpotPositionObject_V2> {
    let po: SpotPositionObject = await this.spot_positions_persistance.as_spot_position_object(
      this.position_identifier
    )
    return { ...po, base_asset: this.base_asset }
  }

  async edge(): Promise<string> {
    return this.position_identifier.edge
  }

  async orders(): Promise<GenericOrderData[]> {
    return await this.spot_positions_persistance.orders(this.position_identifier)
  }

  // adjust the position according to the order, create a new position if current size is zero
  async add_order_to_position({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let { baseAsset, side, totalBaseTradeQuantity, orderType, order_id } = generic_order_data
    let tags = { base_asset: baseAsset }

    if (baseAsset !== this.baseAsset) {
      throw new Error(
        `Unexpected base_asset ${baseAsset} vs ${this.baseAsset} in call to Position.add_order_to_position`
      )
    }

    let num_added = await this.spot_positions_persistance.add_orders(this.position_identifier, [
      generic_order_data,
    ])
    if (num_added === 0) {
      this.logger.event(tags, {
        object_type: "OrderDeduplication",
        msg: `Skipping adding ${orderType} ${side} order id ${order_id} to ${baseAsset} position - already added.`,
      })
      return
    }

    this.logger.event(tags, {
      object_type: "OrderAddedToPosition",
      msg: `Added ${orderType} ${side} order id ${order_id} to ${baseAsset} position`,
    })

    if ((await this.position_size()).isZero()) {
      let i = genericOrderDataToSpotPositionInitialisationData(generic_order_data, await this.edge())
      await this.spot_positions_persistance.initialise_position(this.position_identifier, i)
    } else {
      let base_change =
        side === "BUY" ? new BigNumber(totalBaseTradeQuantity) : new BigNumber(totalBaseTradeQuantity).negated()
      await this.spot_positions_persistance.adjust_position_size_by(this.position_identifier, {
        base_change,
      })
      // TODO: Fire a position changed event
    }
  }

  async percentage_price_change_since_initial_entry(current_price: BigNumber): Promise<BigNumber> {
    let initial_entry_price = await this.initial_entry_price()
    return new BigNumber(current_price).minus(initial_entry_price).dividedBy(initial_entry_price).times(100)
  }

  /** this should be done in SpotEdgeToExecutorMapper */
  // async close() {
  //   this.spot_positions_persistance.close_position(this.position_identifier)
  // }

  async get_SpotPositionOpenedEvent(): Promise<SpotPositionOpenedEvent_V1> {
    let o: SpotPositionObject = await this.describe_position()
    let { edge } = o
    let { base_asset } = this
    let obj: SpotPositionOpenedEvent_V1 = {
      object_type: "SpotPositionOpened",
      object_subtype: "SingleEntryExit", // simple trades with one entry order and one exit order
      version: 1,

      msg: `${base_asset} position opened`,

      edge: o.edge,
      exchange_identifier: this.position_identifier.exchange_identifier,
      base_asset: this.base_asset,

      /** When the entry signal fired */
      // entry_signal_source: string, // bert, service name etc
      entry_signal_timestamp_ms: o.initial_entry_timestamp,
      // entry_signal_price_at_signal: o.,

      /** Executed entry */
      initial_entry_timestamp_ms: o.initial_entry_timestamp,
      initial_entry_executed_price: o.initial_entry_price?.toFixed(), // average entry price (actual)
      initial_entry_quote_asset: o.initial_entry_quote_asset,

      /** Position size */
      initial_entry_quote_invested: o.initial_quote_invested?.toFixed(),
      initial_entry_position_size: o.initial_entry_position_size.toFixed(), // base asset

      /** Presumably just the entry order */
      orders: o.orders,
    }
    this.logger.event({ edge, base_asset }, obj)

    return obj
  }

  /** currently a bit edge60 specific, designed for single order entry and exit trades */
  async get_SpotPositionClosedEvent({
    object_subtype,
    exit_timestamp_ms,
    exit_executed_price, // average exit price (actual)
    exit_quote_asset, // should match initial_entry_quote_asset
    exit_quote_returned, // how much quote did we get when liquidating the position
    exit_position_size, // base asset
  }: {
    object_subtype: "SingleEntryExit"
    exit_timestamp_ms: number
    exit_executed_price: string
    exit_quote_asset: string
    exit_quote_returned: string
    exit_position_size: string
  }): Promise<SpotPositionClosed> {
    let o: SpotPositionObject = await this.describe_position()
    let { base_asset } = this
    let { edge } = o

    let percentage_quote_change, abs_quote_change
    if (o.initial_quote_invested) {
      abs_quote_change = new BigNumber(exit_quote_returned).minus(o.initial_quote_invested)
      percentage_quote_change = abs_quote_change.dividedBy(o.initial_quote_invested).times(100).dp(3).toNumber()
    }

    let pct_changed: string =
      percentage_quote_change && percentage_quote_change > 0
        ? `+${percentage_quote_change}%`
        : `${percentage_quote_change}%` || `(undefined)`
    let obj: SpotPositionClosed = {
      object_type: "SpotPositionClosed",
      object_subtype, //: "SingleEntryExit", // simple trades with one entry order and one exit order
      version: 1,

      edge: o.edge,
      exchange_identifier: this.position_identifier.exchange_identifier,
      base_asset,

      msg: `${base_asset} position closed ${pct_changed}`,

      /** When the entry signal fired */
      // entry_signal_source: string, // bert, service name etc
      entry_signal_timestamp_ms: o.initial_entry_timestamp,
      // entry_signal_price_at_signal: string,

      /** Executed entry */
      initial_entry_timestamp_ms: o.initial_entry_timestamp,
      initial_entry_executed_price: o.initial_entry_price?.toFixed(), // average entry price (actual)
      initial_entry_quote_asset: o.initial_entry_quote_asset,

      /** Position size */
      initial_entry_quote_invested: o.initial_quote_invested?.toFixed(),
      initial_entry_position_size: o.initial_entry_position_size.toFixed(), // base asset

      /** Presumably just the entry order */
      orders: o.orders,

      /** When the exit signal fired */
      // exit_signal_source?: string // bert, service name etc
      // exit_signal_timestamp_ms?: o.
      // exit_signal_price_at_signal?: string

      /** Executed exit */
      exit_timestamp_ms,
      exit_executed_price, // average exit price (actual)
      exit_quote_asset, // should match initial_entry_quote_asset

      /** can be added if quote value was calculated or the same for all orders  */
      exit_quote_returned, // how much quote did we get when liquidating the position
      exit_position_size, // base asset

      total_quote_invested: o.initial_quote_invested?.toFixed(), // same as initial_entry_quote_invested
      total_quote_returned: exit_quote_returned, // same as exit_quote_returned

      abs_quote_change: abs_quote_change?.toFixed(),
      percentage_quote_change, // use a float for this, it's not for real accounting
    }
    this.logger.event({ edge, base_asset }, obj)

    return obj
  }
}
