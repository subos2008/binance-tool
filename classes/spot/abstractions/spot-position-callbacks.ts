import { strict as assert } from "assert"

/**
 * Event publishing on position open/close
 * Used for logging/accounting etc
 */

import Sentry from "../../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { AuthorisedEdgeType } from "./position-identifier"
import { GenericOrderData } from "../../../types/exchange_neutral/generic_order_data"
import { ExchangeIdentifier_V3 } from "../../../events/shared/exchange-identifier"

type _shared_v1 = {
  /**
   * object_subtype: SingleEntryExit:
   * We assume that the entry and exit quote asset are the same,
   * because it gets a little complicated otherwise
   */
  object_subtype: "SingleEntryExit" // simple trades with one entry order and one exit order
  version: 1

  msg?: string

  edge: AuthorisedEdgeType

  exchange_identifier: ExchangeIdentifier_V3
  base_asset: string

  /** When the entry signal fired */
  entry_signal_source?: string // bert, service name etc
  entry_signal_timestamp_ms?: number
  entry_signal_price_at_signal?: string

  /** Executed entry */
  initial_entry_timestamp_ms: number
  initial_entry_executed_price?: string // average entry price (actual)
  initial_entry_quote_asset: string

  /** Position size */
  initial_entry_quote_invested?: string
  initial_entry_position_size: string // base asset

  /** Presumably just the entry order */
  /** A lot of the above can be derived from the orders list */
  orders: GenericOrderData[]
}

export interface SpotPositionOpenedEvent_V1 extends _shared_v1 {
  object_type: "SpotPositionOpened"
}

export interface SpotPositionClosed extends _shared_v1 {
  object_type: "SpotPositionClosed"
  object_class: 'event'
  version: 1

  /** When the exit signal fired */
  exit_signal_source?: string // bert, service name etc
  exit_signal_timestamp_ms?: number
  exit_signal_price_at_signal?: string

  /** Executed exit */
  exit_timestamp_ms: number
  exit_executed_price: string // average exit price (actual)
  exit_quote_asset: string // should match initial_entry_quote_asset

  /** can be added if quote value was calculated or the same for all orders  */
  exit_quote_returned: string // how much quote did we get when liquidating the position
  exit_position_size: string // base asset

  total_quote_invested?: string // same as initial_entry_quote_invested
  total_quote_returned: string // same as exit_quote_returned

  percentage_quote_change?: number // use a float for this, it's not for real accounting
  abs_quote_change?: string
}

export interface SpotPositionClosedEvent_V1_with_percentage_quote_change extends SpotPositionClosed {
  percentage_quote_change: number // use a float for this, it's not for real accounting
  abs_quote_change: string
}

export interface SpotPositionCallbacks {
  on_position_opened(event: SpotPositionOpenedEvent_V1): Promise<void>
  on_position_closed(event: SpotPositionClosed): Promise<void>
}
