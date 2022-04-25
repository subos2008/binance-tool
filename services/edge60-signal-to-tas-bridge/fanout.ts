import { strict as assert } from "assert"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { SpotTradeAbstractionServiceClient } from "../spot-trade-abstraction/client/tas-client"
import { Logger } from "../../interfaces/logger"
import * as Sentry from "@sentry/node"
import { Edge60PositionEntrySignal } from "../../events/shared/edge60-position-entry"
import { Edge60EntrySignalProcessor } from "./interfaces"
import { Edge60Forwarder } from "./forwarder"

export class Edge60EntrySignalFanout implements Edge60EntrySignalProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType
  tas_client: SpotTradeAbstractionServiceClient
  edge60: Edge60EntrySignalProcessor
  edge62: Edge60EntrySignalProcessor

  constructor({
    send_message,
    logger,
    event_name,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    event_name: MyEventNameType
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.tas_client = new SpotTradeAbstractionServiceClient({ logger })
    this.event_name = event_name
    this.edge60 = new Edge60Forwarder({ send_message, logger, event_name, edge: "edge60" })
    this.edge62 = new Edge60Forwarder({ send_message, logger, event_name, edge: "edge62" })
  }

  async process_edge60_entry_signal(signal: Edge60PositionEntrySignal) {
    let { base_asset } = signal.market_identifier
    if (!base_asset) {
      throw new Error(`base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`)
    }

    try {
      await this.edge60.process_edge60_entry_signal(signal)
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }

    try {
      await this.edge62.process_edge60_entry_signal(signal)
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }
  }
}