/**
 * Event/message listener
 */

import { strict as assert } from "assert"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { TradeAbstractionServiceClient } from "../binance/spot/trade-abstraction-v2/client/tas-client"
import { Logger } from "../../interfaces/logger"
import Sentry from "../../lib/sentry"
import { TradeAbstractionOpenLongResult } from "../binance/spot/trade-abstraction-v2/interfaces/long"
import { TradeAbstractionCloseResult } from "../binance/spot/trade-abstraction-v2/interfaces/close"
import { Edge70SignalProcessor } from "./interfaces"
import { AuthorisedEdgeType } from "../../classes/spot/abstractions/position-identifier"
import { Edge70Signal } from "../edge70-signals/interfaces/edge70-signal"

const TAS_URL = process.env.SPOT_TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("SPOT_TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}

export class Edge70ForwarderToEdge70Spot implements Edge70SignalProcessor {
  send_message: Function
  logger: Logger
  event_name: MyEventNameType
  tas_client: TradeAbstractionServiceClient
  forward_short_signals_as_close_position: boolean

  constructor({
    send_message,
    logger,
    event_name,
    forward_short_signals_as_close_position,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    event_name: MyEventNameType
    forward_short_signals_as_close_position: boolean
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.tas_client = new TradeAbstractionServiceClient({ logger, TAS_URL })
    this.event_name = event_name
    this.forward_short_signals_as_close_position = forward_short_signals_as_close_position
  }

  async process_signal(signal: Edge70Signal) {
    assert.equal(signal.object_type, "Edge70Signal")
    assert.equal(signal.edge, "edge70")
    let edge = "edge70"
    
    let { base_asset } = signal.market_identifier
    if (!base_asset) {
      throw new Error(`base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`)
    }
    let tags = { base_asset, edge }

    let result: TradeAbstractionOpenLongResult | TradeAbstractionCloseResult
    switch (signal.signal.direction) {
      case "long":
        this.logger.info(tags, `long signal, attempting to open ${edge} spot long position on ${base_asset}`)
        result = await this.tas_client.long({
          object_type: "TradeAbstractionOpenLongCommand",
          base_asset,
          edge,
          direction: "long",
          action: "open",
          trigger_price: signal.signal.signal_price,
          signal_timestamp_ms: signal.signal.signal_timestamp_ms,
        })
        break
      case "short":
        if (this.forward_short_signals_as_close_position) {
          try {
            this.logger.info(
              tags,
              `short signal, attempting to close any ${edge} spot long position on ${base_asset}`
            )
            result = await this.tas_client.close({
              object_type: "TradeAbstractionCloseCommand",
              version: 1,
              base_asset,
              edge,
              action: "close",
              signal_timestamp_ms: signal.signal.signal_timestamp_ms,
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
        throw new Error(`Unknown direction: ${signal.signal.direction}`)
    }
  }
}
