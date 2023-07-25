/**
 * Event/message listener
 */

import { strict as assert } from "assert"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { TradeAbstractionServiceClient } from "../binance/spot/trade-abstraction-v2/client/tas-client"
import { ServiceLogger } from "../../interfaces/logger"
import Sentry from "../../lib/sentry"
import {
  generate_trade_id,
  TradeAbstractionOpenLongCommand,
  TradeAbstractionOpenLongResult,
} from "../binance/spot/trade-abstraction-v2/interfaces/long"
import {
  TradeAbstractionCloseCommand,
  TradeAbstractionCloseResult,
} from "../binance/spot/trade-abstraction-v2/interfaces/close"
import { Edge70SignalProcessor } from "./interfaces"
import { Edge70Signal } from "../edge70-signals/interfaces/edge70-signal"

const TAS_URL = process.env.SPOT_TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("SPOT_TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}

export class Edge70ForwarderToEdge70Spot implements Edge70SignalProcessor {
  send_message: Function
  logger: ServiceLogger
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
    logger: ServiceLogger
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

  async process_signal(signal: Edge70Signal): Promise<void> {
    assert.equal(signal.object_type, "Edge70Signal")
    assert.equal(signal.edge, "edge70")
    let edge = "edge70"
    let { direction, signal_timestamp_ms } = signal.signal

    let { base_asset } = signal.market_identifier
    if (!base_asset) {
      throw new Error(`base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`)
    }
    let tags = { base_asset, edge, direction }

    let result: TradeAbstractionOpenLongResult | TradeAbstractionCloseResult
    switch (direction) {
      case "long":
        let trade_id = generate_trade_id({ ...tags, direction, signal_timestamp_ms }) // will want to maybe move this later
        this.logger.info(tags, `long signal, attempting to open ${edge} spot long position on ${base_asset}`)
        let cmd: TradeAbstractionOpenLongCommand = {
          object_type: "TradeAbstractionOpenLongCommand",
          object_class: "command",
          base_asset,
          edge,
          trade_id,
          direction: "long",
          action: "open",
          trigger_price: signal.signal.signal_price,
          signal_timestamp_ms: signal.signal.signal_timestamp_ms,
        }
        this.logger.command(tags, cmd, "created")
        result = await this.tas_client.long(cmd)
        this.logger.result(tags, result, "consumed") // NOP
        break
      case "short":
        if (this.forward_short_signals_as_close_position) {
          try {
            this.logger.info(
              tags,
              `short signal, attempting to close any ${edge} spot long position on ${base_asset}`
            )
            let cmd: TradeAbstractionCloseCommand = {
              object_type: "TradeAbstractionCloseCommand",
              object_class: "command",
              version: 1,
              base_asset,
              edge,
              action: "close",
              signal_timestamp_ms: signal.signal.signal_timestamp_ms,
              trigger_price: signal.signal.signal_price,
            }
            this.logger.command(tags, cmd, "created")
            result = await this.tas_client.close(cmd)
            this.logger.result(tags, result, "consumed") // NOP
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
