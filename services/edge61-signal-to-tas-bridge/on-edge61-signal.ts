/**
 * Event/message listener
 */

import { strict as assert } from "assert"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { SpotTradeAbstractionServiceClient } from "../spot-trade-abstraction/client/tas-client"
import { Logger } from "../../interfaces/logger"
import * as Sentry from "@sentry/node"
import { Edge61PositionEntrySignal } from "../../events/shared/edge61-position-entry"
import {
  TradeAbstractionOpenSpotLongCommand,
  TradeAbstractionOpenSpotLongResult,
} from "../spot-trade-abstraction/interfaces/open_spot"
import { SignalSupression } from "./signal-supression"

export interface Edge61EntrySignalProcessor {
  process_edge61_entry_signal: (signal: Edge61PositionEntrySignal) => Promise<void>
}

class Edge61 implements Edge61EntrySignalProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType
  tas_client: SpotTradeAbstractionServiceClient
  signal_supression: SignalSupression

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
    this.signal_supression = new SignalSupression({ logger })
  }

  async process_edge61_entry_signal(signal: Edge61PositionEntrySignal) {
    assert.equal(signal.object_type, "Edge61EntrySignal")
    let { edge } = signal
    let { base_asset } = signal?.market_identifier

    if (signal.version !== "v2") {
      let msg = `Old object_type version: ${signal.version}`
      this.logger.error(msg)
      this.logger.object(signal, { edge, base_asset })
      throw new Error(msg)
    }

    assert.equal(signal.edge, "edge61")

    if (!base_asset) {
      throw new Error(`base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`)
    }

    let signal_allowed = this.signal_supression.signal_allowed(signal)
    if (!signal_allowed) {
      this.send_message(`Supressed: ${signal.edge}:${signal.market_identifier.base_asset} signal in TAS bridge`, {
        edge,
        base_asset,
      })
      return
    }

    let result: TradeAbstractionOpenSpotLongResult
    switch (signal.edge61_entry_signal.direction) {
      case "long":
        this.logger.info(`long signal, attempting to open ${edge} spot long position on ${base_asset}`)
        let cmd: TradeAbstractionOpenSpotLongCommand = {
          base_asset,
          edge,
          direction: "long",
          action: "open",
          trigger_price: signal.edge61_entry_signal.entry_price,
          signal_timestamp_ms: signal.edge61_entry_signal.signal_timestamp_ms.toString(),
        }
        result = await this.tas_client.open_spot_long(cmd)
        break
      case "short":
        try {
          this.logger.info(`short signal, NOP on ${edge}`)
        } catch (err) {
          /**
           * There are probably valid cases for this - like these was no long position open
           */
          this.logger.warn({ err })
          Sentry.captureException(err)
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
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }
  }
}
