/**
 * Event/message listener
 */

import { strict as assert } from "assert"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { SpotTradeAbstractionServiceClient } from "../spot-trade-abstraction/client/tas-client"
import { Logger } from "../../interfaces/logger"
import * as Sentry from "@sentry/node"
import { Edge61PositionEntrySignal } from "../../events/shared/edge61-position-entry"

/**
 * We enter multiple trade types on this signal:
 * edge61     // trend following
 * and edge61 // breakout scalp
 */

/**
 * interface Edge61PositionEntrySignal {
 *   object_type: "Edge61EntrySignal"
 *   version: "v1"
 *   edge: "edge61"
 *   market_identifier: MarketIdentifier_V3
 *   edge61_parameters: Edge61Parameters
 *   edge61_entry_signal: {
 *     direction: "long" | "short"
 *     entry_price: string
 *   }
 *   extra?: {
 *     CoinGeckoMarketData?: CoinGeckoMarketData
 *   }
 * }
 */

export interface Edge61EntrySignalProcessor {
  process_edge61_entry_signal: (signal: Edge61PositionEntrySignal) => Promise<void>
}

class Edge61 implements Edge61EntrySignalProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType
  tas_client: SpotTradeAbstractionServiceClient

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
  }

  async process_edge61_entry_signal(signal: Edge61PositionEntrySignal) {
    assert.equal(signal.version, "v1")
    assert.equal(signal.object_type, "Edge61EntrySignal")
    assert.equal(signal.edge, "edge61")

    let { edge } = signal
    let { base_asset } = signal.market_identifier
    if (!base_asset) {
      throw new Error(`base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`)
    }

    let result: string | undefined
    switch (signal.edge61_entry_signal.direction) {
      case "long":
        this.logger.info(`long signal, attempting to open ${edge} spot long position on ${base_asset}`)
        result = await this.tas_client.open_spot_long({
          base_asset,
          edge,
          direction: "long",
          action: "open",
          trigger_price: signal.edge61_entry_signal.entry_price,
        })
        break
      case "short":
        try {
          this.logger.info(`short signal, attempting to close any ${edge} spot long position on ${base_asset}`)
          result = await this.tas_client.close_spot_long({
            base_asset,
            edge,
            direction: "long", // this direction is confising, it's the direction of the position to close, i.e. short = long
            action: "close",
          })
        } catch (error) {
          /**
           * There are probably valid cases for this - like these was no long position open
           */
          this.logger.warn(error)
          Sentry.captureException(error)
        }
        break
      default:
        throw new Error(`Unknown direction: ${signal.edge61_entry_signal.direction}`)
    }
  }
}

export class Edge61EntrySignalFanout implements Edge61EntrySignalProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType
  tas_client: SpotTradeAbstractionServiceClient
  edge61: Edge61EntrySignalProcessor

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
    this.edge61 = new Edge61({ send_message, logger, event_name })
  }

  async process_edge61_entry_signal(signal: Edge61PositionEntrySignal) {
    let { base_asset } = signal.market_identifier
    if (!base_asset) {
      throw new Error(`base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`)
    }

    try {
      await this.edge61.process_edge61_entry_signal(signal)
    } catch (error) {
      this.logger.error(error)
      Sentry.captureException(error)
    }
    // try {
    //   await this.enter_edge61(signal)
    // } catch (error) {
    //   this.logger.error(error)
    //   Sentry.captureException(error)
    // }
  }
}
