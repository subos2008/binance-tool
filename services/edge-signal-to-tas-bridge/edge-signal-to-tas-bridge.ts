#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * Event/message listener
 */

import { strict as assert } from "assert"
const service_name = "edge-signal-to-tas-bridge"

import { ListenerFactory } from "../../classes/amqp/listener-factory"
import { SpotTradeAbstractionServiceClient } from "../spot-trade-abstraction/client/tas-client"

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

process.on("unhandledRejection", (error) => {
  logger.error(error)
  Sentry.captureException(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

var service_is_healthy: boolean = true

const TAS_URL = process.env.SPOT_TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("SPOT_TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}

import { MessageProcessor } from "../../classes/amqp/interfaces"

let listener_factory = new ListenerFactory({ logger })
class Edge60EntrySignalToSpotTasBridge implements MessageProcessor {
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
    listener_factory.build_isolated_listener({ event_name, message_processor: this }) // Add arbitrary data argument
  }

  async process_message(event: any, channel: Channel) {
    try {
      this.logger.info(event)
      let Body = event.content.toString()
      let Key = `${this.event_name}/${+new Date()}` // ms timestamp
      this.logger.info(`Message Received: ${Body}`)
      let signal: Edge60PositionEntrySignal = JSON.parse(Body)

      /**
       * export interface Edge60PositionEntrySignal {
            version: "v1"
            edge: "edge60"
            event_type: "Edge60EntrySignal"
            market_identifier: MarketIdentifier_V3
            edge60_parameters: Edge60Parameters
            edge60_entry_signal: {
              direction: "long" | "short"
              entry_price: string
            }
            extra?: {
              previous_direction?: "long" | "short"
              CoinGeckoMarketData?: CoinGeckoMarketData
            }
          }
       */
      assert.equal(signal.version, "v1")
      assert.equal(signal.event_type, "Edge60EntrySignal")
      let { base_asset } = signal.market_identifier
      let { edge } = signal
      assert.equal(edge, "edge60")

      if (!base_asset) {
        throw new Error(
          `base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`
        )
      }

      let result: string | undefined
      switch (signal.edge60_entry_signal.direction) {
        case "long":
          send_message(`long signal, attempting to open ${edge} spot long position on ${base_asset}`)
          result = await this.tas_client.open_spot_long({
            base_asset,
            edge,
            direction: "long",
            action: "open",
          })
          channel.ack(event)
          break
        case "short":
          try {
            send_message(`short signal, attempting to close any ${edge} spot long position on ${base_asset}`)
            result = await this.tas_client.close_spot_long({
              base_asset,
              edge,
              direction: "long", // this direction is confising, it's the direction of the position to close, i.e. short = long
              action: "close",
            })
            channel.ack(event)
          } catch (error) {
            /**
             * There are probably valid cases for this - like these was no long position open
             */
            this.logger.warn(error)
            Sentry.captureException(error)
          }
          break
        default:
          throw new Error(`Unknown direction: ${signal.edge60_entry_signal.direction}`)
      }
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error(err)
    }
  }
}

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  new Edge60EntrySignalToSpotTasBridge({ logger, send_message, event_name: "Edge60EntrySignal" })
}

main().catch((error) => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`)
  logger.error(error)
  logger.error(`Error in main loop: ${error.stack}`)
  soft_exit(1, `Error in main loop: ${error}`)
})

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null, reason: string) {
  service_is_healthy = false // it seems service isn't exiting on soft exit, but add this to make sure
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) process.exitCode = exit_code
  Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Channel } from "amqplib"
import express, { Request, Response } from "express"
import { Edge60EntrySignals } from "../../classes/edges/edge60"
import { Edge60PositionEntrySignal } from "../../events/shared/edge60-position-entry"
import { sign } from "crypto"
var app = express()
app.get("/health", function (req: Request, res: Response) {
  if (service_is_healthy) {
    res.send({ status: "OK" })
  } else {
    logger.error(`Service unhealthy`)
    res.status(500).json({ status: "UNHEALTHY" })
  }
})
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
