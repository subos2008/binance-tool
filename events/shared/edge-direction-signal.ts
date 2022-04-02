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

export class EdgeDirectionSignalPublisher {
  logger: Logger
  publisher: GenericTopicPublisher
  event_name: MyEventNameType = "EdgeDirectionSignal"

  constructor(args: { logger: Logger }) {
    this.logger = args.logger
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
    return this.publish(event, options)
  }
}
