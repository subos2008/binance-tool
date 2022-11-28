import Sentry from "../../lib/sentry"

import { MarketIdentifier_V4, MarketIdentifier_V5 } from "./market-identifier"

/** For edges that signal flip-flop long/short */
export interface EdgeDirectionSignal {
  object_type: "EdgeDirectionSignal"
  object_class: "event"
  version: 1
  edge: string
  msg?: string
  direction: "long" | "short"
  base_asset?: string
  quote_asset?: string
  symbol: string
  exchange_type: ExchangeType
  signal_timestamp_ms: number
  market_identifier: MarketIdentifier_V4 | MarketIdentifier_V5
}

import { Options } from "amqplib"
import { GenericTopicPublisher } from "../../classes/amqp/generic-publishers"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Logger } from "../../interfaces/logger"
import { StatsD, Tags } from "hot-shots"
import { ExchangeType } from "./exchange-identifier"
import { HealthAndReadiness } from "../../classes/health_and_readiness"

export class EdgeDirectionSignalPublisher {
  logger: Logger
  dogstatsd: StatsD | undefined
  publisher: GenericTopicPublisher
  event_name: MyEventNameType = "EdgeDirectionSignal"

  constructor(args: { logger: Logger; dogstatsd: StatsD; health_and_readiness: HealthAndReadiness }) {
    this.logger = args.logger
    this.dogstatsd = args.dogstatsd
    this.publisher = new GenericTopicPublisher({
      logger: args.logger,
      event_name: this.event_name,
      health_and_readiness: args.health_and_readiness,
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
      if (this.dogstatsd) {
        let { edge, direction, base_asset } = event
        let tags: Tags = {
          edge,
          direction,
        }
        if (base_asset) tags.base_asset = base_asset
        this.dogstatsd.increment(`trading_engine.edge_signal_long_short`, 1, undefined, tags)
      }
    } catch (e) {
      this.logger.warn(`Failed to submit metrics to DogStatsD`)
      Sentry.captureException(e)
    }
    return this.publisher.publish(event, options)
  }
}
