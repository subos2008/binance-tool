import { strict as assert } from "assert"

/**
 * Event publishing on position open/close
 * Used for logging/accounting etc
 */

import * as Sentry from "@sentry/node"
Sentry.init({})
// Sentry.configureScope(function (scope: any) {
//   scope.setTag("service", service_name)
// })

import { Logger } from "../../../interfaces/logger"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { GenericTopicPublisher } from "../../amqp/generic-publishers"
import { HealthAndReadinessSubsystem } from "../../health_and_readiness"
import { AuthorisedEdgeType } from "./position-identifier"
import { GenericOrderData } from "../../../types/exchange_neutral/generic_order_data"
import _ from "lodash"
import { MarketIdentifier_V3 } from "../../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../../events/shared/exchange-identifier"

type _shared_v1 = {
  /**
   * object_subtype: SingleEntryExit:
   * We assume that the entry and exit quote asset are the same,
   * because it gets a little complicated otherwise
   */
  object_subtype: "SingleEntryExit" // simple trades with one entry order and one exit order
  version: 1

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

export interface SpotPositionClosedEvent_V1 extends _shared_v1 {
  object_type: "SpotPositionClosed"
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

export class SpotPositionPublisher {
  logger: Logger
  publisher_opened: GenericTopicPublisher
  publisher_closed: GenericTopicPublisher
  health_and_readiness: HealthAndReadinessSubsystem

  constructor({
    logger,
    health_and_readiness,
  }: {
    logger: Logger
    health_and_readiness: HealthAndReadinessSubsystem
  }) {
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.publisher_opened = new GenericTopicPublisher({ logger, event_name: "SpotPositionOpened" })
    this.publisher_closed = new GenericTopicPublisher({ logger, event_name: "SpotPositionClosed" })
  }

  async connect(): Promise<void> {
    await this.publisher_opened.connect()
    await this.publisher_closed.connect()
    this.health_and_readiness.ready(true)
  }

  async publish_open(event: SpotPositionOpenedEvent_V1): Promise<void> {
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    try {
      await this.publisher_opened.publish(event, options)
    } catch (e) {
      this.health_and_readiness.healthy(false)
    }
  }

  async publish_closed(event: SpotPositionClosedEvent_V1): Promise<void> {
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    try {
      await this.publisher_closed.publish(event, options)
    } catch (e) {
      this.health_and_readiness.healthy(false)
    }
  }

  async shutdown_streams() {
    if (this.publisher_opened) this.publisher_opened.shutdown_streams()
    if (this.publisher_closed) this.publisher_closed.shutdown_streams()
  }
}
