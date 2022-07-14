/**
 * Event/message listener
 */

import { strict as assert } from "assert"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { TradeAbstractionServiceClient } from "../binance/spot/trade-abstraction/client/tas-client"
import { Logger } from "../../interfaces/logger"
import Sentry from "../../lib/sentry"
import { Edge60PositionEntrySignal } from "../../events/shared/edge60-position-entry"
import {
  TradeAbstractionOpenSpotLongResult,
} from "../binance/spot/trade-abstraction/interfaces/open_spot"
import {
  TradeAbstractionCloseSpotLongResult,
} from "../binance/spot/trade-abstraction/interfaces/close_spot"
import { Edge60EntrySignalProcessor } from "./interfaces"
import { AuthorisedEdgeType } from "../../classes/spot/abstractions/position-identifier"

/**
 * interface Edge60PositionEntrySignal {
 *   object_type: "Edge60EntrySignal"
 *   version: "v1"
 *   edge: "edge60"
 *   market_identifier: MarketIdentifier_V4
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

export class Edge60ForwarderToEdge60Spot implements Edge60EntrySignalProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType
  tas_client: TradeAbstractionServiceClient
  edge: AuthorisedEdgeType
  forward_short_signals_as_close_position: boolean

  constructor({
    send_message,
    logger,
    event_name,
    edge,
    forward_short_signals_as_close_position,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    event_name: MyEventNameType
    edge: AuthorisedEdgeType
    forward_short_signals_as_close_position: boolean
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.tas_client = new TradeAbstractionServiceClient({ logger })
    this.event_name = event_name
    this.edge = edge
    this.forward_short_signals_as_close_position = forward_short_signals_as_close_position
  }

  async process_edge60_entry_signal(signal: Edge60PositionEntrySignal) {
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
          object_type: "TradeAbstractionOpenLongCommand",
          base_asset,
          edge,
          direction: "long",
          action: "open",
          trigger_price: signal.edge60_entry_signal.signal_price,
          signal_timestamp_ms: signal.edge60_entry_signal.signal_timestamp_ms.toString(),
        })
        break
      case "short":
        if (this.forward_short_signals_as_close_position) {
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
          } catch (err: any) {
            /**
             * There are probably valid cases for this - like these was no long position open
             */
            if (err.status == 404) {
              this.logger.info(tags, `404 - position not found closing ${base_asset} spot long`)
              return
            }
            this.logger.warn(tags, { err })
            Sentry.captureException(err)
          }
        }
        break
      default:
        throw new Error(`Unknown direction: ${signal.edge60_entry_signal.direction}`)
    }
  }
}