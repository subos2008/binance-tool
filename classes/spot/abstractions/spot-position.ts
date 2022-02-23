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

import { Logger } from "../../../interfaces/logger"
import { AuthorisedEdgeType, check_edge, SpotPositionIdentifier_V3 } from "./position-identifier"
import { GenericOrderData } from "../../../types/exchange_neutral/generic_order_data"
import {
  genericOrderDataToSpotPositionInitialisationData,
  SpotPositionsPersistance,
} from "../persistence/interface/spot-positions-persistance"
import { SpotPositionClosedEvent_V1, SpotPositionOpenedEvent_V1 } from "./spot-position-publisher"

export type SpotPositionObject = {
  initial_entry_timestamp: number
  position_size: BigNumber
  initial_quote_invested: BigNumber
  initial_entry_quote_asset: string
  initial_entry_price: BigNumber
  initial_entry_position_size: BigNumber
  orders: GenericOrderData[]
  edge: AuthorisedEdgeType
  stop_order_id?: string
}

export class SpotPosition {
  logger: Logger
  send_message: Function | undefined
  spot_positions_persistance: SpotPositionsPersistance
  position_identifier: SpotPositionIdentifier_V3

  constructor({
    logger,
    send_message,
    spot_positions_persistance,
    position_identifier,
  }: {
    logger: Logger
    send_message?: Function
    spot_positions_persistance: SpotPositionsPersistance
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

  async describe_position(): Promise<SpotPositionObject> {
    return this.spot_positions_persistance.as_spot_position_object(this.position_identifier)
  }

  async edge(): Promise<AuthorisedEdgeType> {
    return check_edge(await this.spot_positions_persistance.edge(this.position_identifier))
  }

  async orders(): Promise<GenericOrderData[]> {
    return await this.spot_positions_persistance.orders(this.position_identifier)
  }

  // // Create a new position in the state
  // // NB: does not send a NewPosition event as that would require AQMP access,
  // // We could take that as an argument. Or there are RO vs RW versions of this class
  // async create({ generic_order_data }: { generic_order_data: GenericOrderData }) {
  //   if (this.send_message) this.send_message(`New position for ${generic_order_data.baseAsset}`)
  //   if (!generic_order_data.edge) throw new Error(`Refusing to create position for unknown edge`)
  //   this.spot_positions_persistance.create_new_position(this.position_identifier, {
  //     position_size: new BigNumber(generic_order_data.totalBaseTradeQuantity),
  //     initial_entry_price: new BigNumber(generic_order_data.averageExecutionPrice),
  //     initial_quote_invested: new BigNumber(generic_order_data.totalQuoteTradeQuantity),
  //     initial_entry_quote_asset: generic_order_data.quoteAsset,
  //     initial_entry_timestamp: generic_order_data.orderTime,
  //     orders: [generic_order_data],
  //     edge: check_edge(generic_order_data.edge),
  //   })
  // }

  // adjust the position according to the order, create a new position if current size is zero
  async add_order_to_position({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let { baseAsset, side, totalBaseTradeQuantity } = generic_order_data
    if (baseAsset !== this.baseAsset) {
      throw new Error(
        `Unexpected base_asset ${baseAsset} vs ${this.baseAsset} in call to Position.add_order_to_position`
      )
    }
    if ((await this.position_size()).isZero()) {
      let i = genericOrderDataToSpotPositionInitialisationData(generic_order_data)
      await this.spot_positions_persistance.initialise_position(this.position_identifier, i) // interestingly this would create long and short positions automatically
    } else {
      // TODO: when we add this to redis we could use a hash keyed by order number to prevent duplicate entries?
      let base_change =
        side === "BUY" ? new BigNumber(totalBaseTradeQuantity) : new BigNumber(totalBaseTradeQuantity).negated()
      await this.spot_positions_persistance.adjust_position_size_by(this.position_identifier, {
        base_change,
      })
      await this.spot_positions_persistance.add_orders(this.position_identifier, [generic_order_data])
      // TODO: Fire a position changed event
    }
  }

  async percentage_price_change_since_initial_entry(current_price: BigNumber): Promise<BigNumber> {
    let initial_entry_price = await this.initial_entry_price()
    return new BigNumber(current_price).minus(initial_entry_price).dividedBy(initial_entry_price).times(100)
  }

  /** this should be done in SpotPositionsExecution */
  // async close() {
  //   this.spot_positions_persistance.close_position(this.position_identifier)
  // }

  async get_SpotPositionOpenedEvent(): Promise<SpotPositionOpenedEvent_V1> {
    let o: SpotPositionObject = await this.describe_position()
    return {
      object_type: "SpotPositionOpened",
      object_subtype: "SingleEntryExit", // simple trades with one entry order and one exit order
      version: 1,

      edge: o.edge,

      /** When the entry signal fired */
      // entry_signal_source: string, // bert, service name etc
      // entry_signal_timestamp_ms: number,
      // entry_signal_price_at_signal: string,

      /** Executed entry */
      initial_entry_timestamp_ms: o.initial_entry_timestamp,
      initial_entry_executed_price: o.initial_entry_price.toFixed(), // average entry price (actual)
      initial_entry_quote_asset: o.initial_entry_quote_asset,

      /** Position size */
      initial_entry_quote_invested: o.initial_quote_invested.toFixed(),
      initial_entry_position_size: o.initial_entry_position_size.toFixed(), // base asset

      /** Presumably just the entry order */
      orders: o.orders,
    }
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
  }): Promise<SpotPositionClosedEvent_V1> {
    let o: SpotPositionObject = await this.describe_position()
    let r: SpotPositionClosedEvent_V1 = {
      object_type: "SpotPositionClosed",
      object_subtype, //: "SingleEntryExit", // simple trades with one entry order and one exit order
      version: 1,

      edge: o.edge,

      /** When the entry signal fired */
      // entry_signal_source: string, // bert, service name etc
      // entry_signal_timestamp_ms: number,
      // entry_signal_price_at_signal: string,

      /** Executed entry */
      initial_entry_timestamp_ms: o.initial_entry_timestamp,
      initial_entry_executed_price: o.initial_entry_price.toFixed(), // average entry price (actual)
      initial_entry_quote_asset: o.initial_entry_quote_asset,

      /** Position size */
      initial_entry_quote_invested: o.initial_quote_invested.toFixed(),
      initial_entry_position_size: o.initial_entry_position_size.toFixed(), // base asset

      /** Presumably just the entry order */
      orders: o.orders,

      /** When the exit signal fired */
      // exit_signal_source?: string // bert, service name etc
      // exit_signal_timestamp_ms?: number
      // exit_signal_price_at_signal?: string

      /** Executed exit */
      exit_timestamp_ms,
      exit_executed_price, // average exit price (actual)
      exit_quote_asset, // should match initial_entry_quote_asset

      /** can be added if quote value was calculated or the same for all orders  */
      exit_quote_returned, // how much quote did we get when liquidating the position
      exit_position_size, // base asset

      total_quote_invested: o.initial_quote_invested.toFixed(), // same as initial_entry_quote_invested
      total_quote_returned: exit_quote_returned, // same as exit_quote_returned

      percentage_quote_change: new BigNumber(exit_quote_returned)
        .minus(o.initial_quote_invested)
        .dividedBy(o.initial_quote_invested)
        .times(100)
        .toNumber(), // use a float for this, it's not for real accounting
    }

    return r
  }
}
