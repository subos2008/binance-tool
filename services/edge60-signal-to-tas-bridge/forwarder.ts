/**
 * Event/message listener
 */

import { strict as assert } from "assert"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { SpotTradeAbstractionServiceClient } from "../spot-trade-abstraction/client/tas-client"
import { Logger } from "../../interfaces/logger"
import * as Sentry from "@sentry/node"
import { Edge60PositionEntrySignal } from "../../events/shared/edge60-position-entry"
import {
  TradeAbstractionOpenSpotLongCommand,
  TradeAbstractionOpenSpotLongResult,
} from "../spot-trade-abstraction/interfaces/open_spot"
import {
  TradeAbstractionCloseLongCommand,
  TradeAbstractionCloseSpotLongResult,
} from "../spot-trade-abstraction/interfaces/close_spot"
import { Edge60EntrySignalProcessor } from "./interfaces"
import { AuthorisedEdgeType, check_edge } from "../../classes/spot/abstractions/position-identifier"

/**
 * interface Edge60PositionEntrySignal {
 *   object_type: "Edge60EntrySignal"
 *   version: "v1"
 *   edge: "edge60"
 *   market_identifier: MarketIdentifier_V3
 *   edge60_parameters: Edge60Parameters
 *   edge60_entry_signal: {
 *     direction: "long" | "short"
 *     entry_price: string
 *   }
 *   extra?: {
 *     previous_direction?: "long" | "short"
 *     CoinGeckoMarketData?: CoinGeckoMarketData
 *   }
 * }
 */

export class Edge60Forwarder implements Edge60EntrySignalProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType
  tas_client: SpotTradeAbstractionServiceClient
  edge: AuthorisedEdgeType

  constructor({
    send_message,
    logger,
    event_name,
    edge,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    event_name: MyEventNameType
    edge: AuthorisedEdgeType
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.tas_client = new SpotTradeAbstractionServiceClient({ logger })
    this.event_name = event_name
    this.edge = edge
  }

  async process_edge60_entry_signal(signal: Edge60PositionEntrySignal) {
    assert.equal(signal.version, "v1")
    assert.equal(signal.object_type, "Edge60EntrySignal")
    assert.equal(signal.edge, "edge60")

    let edge = this.edge
    let { base_asset } = signal.market_identifier
    if (!base_asset) {
      throw new Error(`base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`)
    }
    let tags = { base_asset, edge }

    let result: TradeAbstractionOpenSpotLongResult | TradeAbstractionCloseSpotLongResult
    switch (signal.edge60_entry_signal.direction) {
      case "long":
        this.logger.info(tags, `long signal, attempting to open ${edge} spot long position on ${base_asset}`)
        result = await this.tas_client.open_spot_long({
          base_asset,
          edge,
          direction: "long",
          action: "open",
          trigger_price: signal.edge60_entry_signal.signal_price,
          signal_timestamp_ms: signal.edge60_entry_signal.signal_timestamp_ms.toString(),
        })
        break
      case "short":
        try {
          this.logger.info(
            tags,
            `short signal, attempting to close any ${edge} spot long position on ${base_asset}`
          )
          result = await this.tas_client.close_spot_long({
            base_asset,
            edge,
            direction: "long", // this direction is confising, it's the direction of the position to close, i.e. short = long
            action: "close",
          })
        } catch (err) {
          /**
           * There are probably valid cases for this - like these was no long position open
           */
          this.logger.warn(tags, { err })
          Sentry.captureException(err)
        }
        break
      default:
        throw new Error(`Unknown direction: ${signal.edge60_entry_signal.direction}`)
    }
  }
}
