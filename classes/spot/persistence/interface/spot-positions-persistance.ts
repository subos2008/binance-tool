import { BigNumber } from "bignumber.js"
import { ExchangeIdentifier } from "../../../../events/shared/exchange-identifier"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { AuthorisedEdgeType, SpotPositionIdentifier_V3 } from "../../abstractions/position-identifier"
import { GenericOrderData } from "../../../../types/exchange_neutral/generic_order_data"
import { OrderId } from "./order-context-persistence"
import { SpotPositionObject } from "../../abstractions/spot-position"

// export interface PositionReservationCommand {
//   trade_id: string
//   timeout_ms: number
//   market_identifier: MarketIdentifier_V3
// }

// export interface PositionIdentifier {
/** this could be an opaque UUID
 * could it also be a market identifier because as long as market identifiers include the account, exchange etc
 * then we can only have one position per market. So a trade has a uuid
 * All we really need at the moment is:
 *  1. are we already in a position
 *  2. whats the performance since entry?
 *
 * But no because we key positions based on the base_asset, not the entry market
 *
 * So really a position is a holding when it's spot - and each order should have a different market
 * We might event want to code spot completely differently bacause a SpotPosition is really a Holding
 * It doesn't have a V3 market identifier - it does have an exchange identifier
 *
 * So lets KISS it for now and just implement what we readlly need - which is:
 * 1. Are we in a position on the given spot exchange identifier for base_asset already?
 * 2. what price did we enter at?
 * 3. isolated namespaces for spot and futures on binance so redis paths need updating
 */
// }

// An old type, used when we want to do something like console.log a position
// Probably should be depricated
export type SpotPositionInitialisationData = {
  initial_entry_timestamp: number // yes
  position_size: BigNumber // yes
  initial_quote_invested: BigNumber
  initial_entry_quote_asset: string
  initial_entry_price: BigNumber
  orders: GenericOrderData[]
  edge: AuthorisedEdgeType // added this
}

export function genericOrderDataToSpotPositionInitialisationData(
  o: GenericOrderData
): SpotPositionInitialisationData {
  return {
    initial_entry_timestamp: o.orderTime,
    position_size: new BigNumber(o.totalBaseTradeQuantity),
    initial_quote_invested: new BigNumber(o.totalQuoteTradeQuantity),
    initial_entry_quote_asset: o.quoteAsset,
    initial_entry_price: new BigNumber(o.averageExecutionPrice),
    orders: [o],
    edge: o.edge as AuthorisedEdgeType,
  }
}

export interface SpotPositionsPersistance {
  list_open_positions(): Promise<SpotPositionIdentifier_V3[]>
  position_size(pi: SpotPositionIdentifier_V3): Promise<BigNumber>
  initial_entry_price(pi: SpotPositionIdentifier_V3): Promise<BigNumber>
  initial_entry_quote_asset(pi: SpotPositionIdentifier_V3): Promise<string>
  initial_entry_timestamp_ms(pi: SpotPositionIdentifier_V3): Promise<number>
  edge(pi: SpotPositionIdentifier_V3): Promise<string>
  orders(pi: SpotPositionIdentifier_V3): Promise<GenericOrderData[]>

  /* hacky*/
  in_position(pi: SpotPositionIdentifier_V3): Promise<boolean>
  as_spot_position_object(pi: SpotPositionIdentifier_V3): Promise<SpotPositionObject>

  /** low level, direct on the data */
  initialise_position(
    pi: SpotPositionIdentifier_V3,
    position_initialisation_data: SpotPositionInitialisationData
  ): Promise<void>
  delete_position(pi: SpotPositionIdentifier_V3): Promise<void>

  /* Kinda atomic mutation functions */
  adjust_position_size_by(
    pi: SpotPositionIdentifier_V3,
    { base_change }: { base_change: BigNumber }
  ): Promise<void>
  add_orders(pi: SpotPositionIdentifier_V3, orders: GenericOrderData[]): Promise<void>

  /**
   * this is a bit hacky because we assume there is only one stop order,
   * edge60 wants to know what its stop order is when cancelling the order
   * so this is our not-over-architected way of storing an order_id that needs to be cancelled
   */
  set_stop_order(pi: SpotPositionIdentifier_V3, order_id: OrderId): Promise<void>
  get_stop_order(pi: SpotPositionIdentifier_V3): Promise<OrderId | undefined>
  /** end the edge61 variant */
  set_oco_order(pi: SpotPositionIdentifier_V3, order_id: OrderId): Promise<void>
  get_oco_order(pi: SpotPositionIdentifier_V3): Promise<OrderId>
}
