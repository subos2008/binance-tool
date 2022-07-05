import { strict as assert } from "assert"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { TradeAbstractionServiceClient } from "../binance/spot/trade-abstraction/client/tas-client"
import { Logger } from "../../interfaces/logger"
import * as Sentry from "@sentry/node"
import { Edge60PositionEntrySignal } from "../../events/shared/edge60-position-entry"
import { Edge60EntrySignalProcessor } from "./interfaces"
import { Edge60Forwarder } from "./forwarder"
import { Edge60ForwarderToEdge62Spot } from "./forwarder-to-edge62-spot"
import { Edge60ForwarderToEdge62Futures } from "./forwarder-to-edge62-futures"

export class Edge60EntrySignalFanout implements Edge60EntrySignalProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType
  tas_client: TradeAbstractionServiceClient
  edge60: Edge60EntrySignalProcessor
  edge62_spot: Edge60EntrySignalProcessor
  edge62_futures: Edge60EntrySignalProcessor

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
    this.tas_client = new TradeAbstractionServiceClient({ logger })
    this.event_name = event_name

    this.edge60 = new Edge60Forwarder({
      send_message,
      logger,
      event_name,
      edge: "edge60",
      forward_short_signals_as_close_position: true,
    })

    this.edge62_spot = new Edge60ForwarderToEdge62Spot({
      send_message,
      logger,
      event_name,
      edge: "edge62",
      forward_short_signals_as_close_position: false,
    })

    this.edge62_futures = new Edge60ForwarderToEdge62Futures({
      send_message,
      logger,
    })
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
      await this.edge62_spot.process_edge60_entry_signal(signal)
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }

    try {
      await this.edge62_futures.process_edge60_entry_signal(signal)
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }
  }
}
