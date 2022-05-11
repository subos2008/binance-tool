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
import BigNumber from "bignumber.js"

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

export class Edge60ForwarderToEdge62Futures implements Edge60EntrySignalProcessor {
  send_message: Function
  logger: Logger
  // event_name: MyEventNameType
  tas_client: SpotTradeAbstractionServiceClient
  edge: AuthorisedEdgeType = "edge62"

  constructor({ send_message, logger }: { send_message: (msg: string) => void; logger: Logger }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.tas_client = new SpotTradeAbstractionServiceClient({ logger })
  }

  async process_edge60_entry_signal(signal: Edge60PositionEntrySignal) {
    let edge = this.edge
    let { base_asset } = signal.market_identifier
    if (!base_asset) {
      throw new Error(`base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`)
    }
    let direction = signal.edge60_entry_signal.direction
    let tags = { base_asset, edge, direction }

    let result: TradeAbstractionOpenSpotLongResult | TradeAbstractionCloseSpotLongResult
    switch (signal.edge60_entry_signal.direction) {
      case "long":
        // Long signal is a nop on the futures exchange atm

        this.logger.info(tags, `Ignoring ${edge} ${direction} signal on ${base_asset} for futures forwarding`)
        break
      case "short":
        try {
          // this.logger.info(
          //   tags,
          //   `short signal, attempting to close any ${edge} spot long position on ${base_asset}`
          // )
          try {
            //hack
            let trigger_price = new BigNumber(signal.edge60_entry_signal.signal_price)
            let tp = trigger_price.times("0.93").toFixed()
            let sl = trigger_price.times("1.07").toFixed()
            this.send_message(
              `${edge} SHORT ${base_asset} - Trigger Price: ${trigger_price.toFixed()} TP ${tp} SL ${sl}`,
              tags
            )
          } catch (e) {
            console.error(e)
          }
          // result = await this.tas_client.open_futures_short({
          //   base_asset,
          //   edge,
          //   direction: "long", // this direction is confising, it's the direction of the position to close, i.e. short = long
          //   action: "close",
          // })
        } catch (err: any) {
          /**
           * There are probably valid cases for this - like these was no long position open
           */
          if (err.status == 404) {
            this.logger.info(
              tags,
              `404 - position not found processing ${signal.edge60_entry_signal.direction} ${base_asset} `
            )
            return
          }
          this.logger.warn(tags, { err })
          Sentry.captureException(err)
        }
        break
      default:
        throw new Error(`Unknown direction: ${signal.edge60_entry_signal.direction}`)
    }
  }
}