import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"

export interface PositionReservationCommand {
  trade_id: string
  timeout_ms: number
  market_identifier: MarketIdentifier_V3
}

export interface PositionIdentifier {
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
}

// from events/shared
// export interface PositionIdentifier {
//   exchange_identifier: ExchangeIdentifier // yeah exchange, not market for spot - but market for futures
//   baseAsset: string
//   baseAssetAmount?: BigNumber // wtf?
// }

// Should be similar to a PositionIdentifier
export interface ReservedPosition {}

export type PositionInitialisationData = any

// From classes/position.ts
// export type PositionObject = {
//   initial_entry_timestamp: number // yes
//   position_size: BigNumber // yes
//   initial_quote_invested: BigNumber
//   initial_entry_quote_asset: string
//   initial_entry_price: BigNumber
//   orders: GenericOrderData[]
//   edge: string // added this
// }

export interface PositionsPersistance {
  reserve_position_if_not_already_existing(cmd: PositionReservationCommand): Promise<ReservedPosition | null>
  cancel_reserved_position(reserved_position: ReservedPosition): Promise<void>
  /** setup_reserved_position: once the orders have executed and we have a position, call this
   * to make it real
   */
  setup_reserved_position(
    reserved_position: ReservedPosition,
    position_initialisation_data: PositionInitialisationData
  ): Promise<void>

  open_positions(): Promise<any>
}
