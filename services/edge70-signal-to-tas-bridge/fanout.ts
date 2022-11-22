import { strict as assert } from "assert"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { TradeAbstractionServiceClient } from "../binance/spot/trade-abstraction-v2/client/tas-client"
import { Logger, ServiceLogger } from "../../interfaces/logger"
import Sentry from "../../lib/sentry"
import { Edge70SignalProcessor } from "./interfaces"
import { Edge70ForwarderToEdge70Spot } from "./forwarder-to-edge70-spot"
import { Edge70Signal } from "../edge70-signals/interfaces/edge70-signal"

const TAS_URL = process.env.SPOT_TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("SPOT_TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}

export class Edge70SignalFanout implements Edge70SignalProcessor {
  send_message: Function
  logger: ServiceLogger
  event_name: MyEventNameType
  tas_client: TradeAbstractionServiceClient
  edge70_spot: Edge70SignalProcessor

  constructor({
    send_message,
    logger,
    event_name,
  }: {
    send_message: (msg: string) => void
    logger: ServiceLogger
    event_name: MyEventNameType
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.tas_client = new TradeAbstractionServiceClient({ logger, TAS_URL })
    this.event_name = event_name

    this.edge70_spot = new Edge70ForwarderToEdge70Spot({
      send_message,
      logger,
      event_name,
      forward_short_signals_as_close_position: true,
    })
  }

  async process_signal(signal: Edge70Signal) {
    let { base_asset } = signal.market_identifier
    if (!base_asset) {
      throw new Error(`base_asset not specified in market_identifier: ${JSON.stringify(signal.market_identifier)}`)
    }

    try {
      await this.edge70_spot.process_signal(signal)
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }
  }
}
