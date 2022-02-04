import { BigNumber } from "bignumber.js"
import { ExchangeIdentifier } from "../../events/shared/exchange-identifier"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { AuthorisedEdgeType } from "../../events/shared/position-identifier"
import { GenericOrderData } from "../../types/exchange_neutral/generic_order_data"
import { SpotPositionIdentifier } from "./spot-interfaces"

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

export type SpotPositionInitialisationData = PositionObject

// From classes/position.ts
type PositionObject = {
  initial_entry_timestamp: number // yes
  position_size: BigNumber // yes
  initial_quote_invested: BigNumber
  initial_entry_quote_asset: string
  initial_entry_price: BigNumber
  orders: GenericOrderData[]
  edge: AuthorisedEdgeType // added this
}

export interface SpotPositionsPersistance {
  initialise_position(
    pi: SpotPositionIdentifier,
    position_initialisation_data: SpotPositionInitialisationData
  ): Promise<void>

  list_open_positions(): Promise<SpotPositionIdentifier[]>
  position_size(pi: SpotPositionIdentifier): Promise<BigNumber>

  /* hacky*/
  in_position(pi: SpotPositionIdentifier): Promise<boolean>
}
