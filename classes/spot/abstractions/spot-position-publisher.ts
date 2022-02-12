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
import { SpotPositionInitialisationData } from "../persistence/interface/spot-positions-persistance"
import { AuthorisedEdgeType } from "./position-identifier"
import { GenericOrderData } from "../../../types/exchange_neutral/generic_order_data"

need to add event_type and version here
export type SpotPositionOpenedEvent_V1 = {
  event_type: "SpotPositionClosedEvent"
  version: 1
  initial_entry_timestamp: number
  position_size: string
  initial_quote_invested: string
  initial_entry_quote_asset: string
  initial_entry_price: string
  orders: GenericOrderData[]
  edge: AuthorisedEdgeType
}

export interface SpotPositionClosedEvent_V1 {
  /**
   * We assume here that the entry and exit quote asset are the same,
   * because it gets a little complicated otherwise
   * 
   * To add:
   *  - reason the position closed? Stopped out? Exit Signal? But we might
   *    want to keep it simple because edges can be wildly different. i.e
   *    the concept of did a position close sucessfully - at the end of the
   *    day means did it close with a positive net quote value - it still
   *    might close in profit and have hit a (trailing) stop
   *  - usd equivalent? GenericOrderData can also include this
   *  - entry/exit slippage (triggered exit price vs averageExecuted price)
   * Derived:
   *  - net quote change?
   *  - percentage quote change?
   * */
  event_type: "SpotPositionClosedEvent"
  version: 1
  /** everything else can be derived from edge and an orders list */
  edge: AuthorisedEdgeType
  orders: GenericOrderData[] 

  /** derivable values to make things easier
   * .. although actually entry timestamp could be trigger (signal) vs execution timestamp too
   * if an edge entered with limit buy orders
   */

  initial_entry_timestamp_ms: number
  position_closed_timestamp_ms: number

  /** can be added if quote value was calculated or the same for all orders  */
  quote_asset?: string
  total_quote_invested?: string
  total_quote_returned?: string
  net_quote?: string
  percentage_quote_change?: number // use a float for this, it's not for real accounting
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
      await this.publisher_opened.publish(JSON.stringify(event), options)
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
      await this.publisher_closed.publish(JSON.stringify(event), options)
    } catch (e) {
      this.health_and_readiness.healthy(false)
    }
  }

  async shutdown_streams() {
    if (this.publisher_opened) this.publisher_opened.shutdown_streams()
    if (this.publisher_closed) this.publisher_closed.shutdown_streams()
  }
}
