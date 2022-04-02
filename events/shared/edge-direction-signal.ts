import * as Sentry from "@sentry/node" // what happens if you don't call init?

import { AuthorisedEdgeType } from "../../classes/spot/abstractions/position-identifier"
import { MarketIdentifier_V3 } from "./market-identifier"

/** For edges that signal flip-flop long/short */
export interface EdgeDirectionSignal {
  object_type: "EdgeDirectionSignal"
  version: "v1"
  edge: AuthorisedEdgeType
  direction: "long" | "short"
  base_asset?: string
  quote_asset?: string
  symbol: string
  exchange_type: "spot" | "margin"
  signal_timestamp_ms: string

  market_identifier: MarketIdentifier_V3
}

import { Options } from "amqplib"
import { GenericTopicPublisher } from "../../classes/amqp/generic-publishers"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Logger } from "../../interfaces/logger"
import { StatsD, Tags } from "hot-shots"

export class EdgeDirectionSignalPublisher {
  logger: Logger
  statsd: StatsD | undefined
  publisher: GenericTopicPublisher
  event_name: MyEventNameType = "EdgeDirectionSignal"

  constructor(args: { logger: Logger; statsd: StatsD }) {
    this.logger = args.logger
    this.statsd = args.statsd
    this.publisher = new GenericTopicPublisher({
      logger: args.logger,
      event_name: this.event_name,
    })
  }

  async connect() {
    this.publisher.connect()
  }

  async shutdown_streams() {
    this.publisher.shutdown_streams()
  }

  publish(event: EdgeDirectionSignal, options?: Options.Publish): Promise<boolean> {
    try {
      if (this.statsd) {
        let { edge, direction, base_asset } = event
        let tags: Tags = {
          edge,
          direction,
        }
        if (base_asset) tags.base_asset = base_asset
        this.statsd.increment(`trading-engine.edge-signal-long-short`, 1, undefined, tags)
      }
    } catch (e) {
      this.logger.warn(`Failed to submit metrics to DogStatsD`)
      Sentry.captureException(e)
    }
    return this.publish(event, options)
  }
}
