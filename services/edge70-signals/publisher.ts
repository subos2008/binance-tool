import Sentry from "../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Edge70Parameters, Edge70Signal } from "./interfaces/edge70-signal"
import { TypedGenericTopicPublisher } from "../../classes/amqp/typed-generic-publisher"
import { EdgeDirectionSignal, EdgeDirectionSignalPublisher } from "../../events/shared/edge-direction-signal"
import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { MarketIdentifier_V5 } from "../../events/shared/market-identifier"
import { StatsD } from "hot-shots"
import { MarketData } from "./market-data"
import { CoinGeckoMarketData } from "../../classes/utils/coin_gecko"
import { Edge70SignalCallbacks } from "./interfaces/_internal"
import { SendMessageFunc } from "../../interfaces/send-message"
import { ServiceLogger } from "../../interfaces/logger"

var dogstatsd = new StatsD()

export class Edge70AMQPSignalPublisher implements Edge70SignalCallbacks {
  logger: ServiceLogger
  send_message: SendMessageFunc
  edge: "edge70" | "edge70-backtest"
  signal_publisher: TypedGenericTopicPublisher<Edge70Signal>
  publisher_for_EdgeDirectionSignal: EdgeDirectionSignalPublisher
  health_and_readiness: HealthAndReadiness
  market_data: MarketData | undefined

  constructor({
    logger,
    edge,
    send_message,
    health_and_readiness,
    market_data,
  }: {
    logger: ServiceLogger
    edge: "edge70" | "edge70-backtest"
    send_message: SendMessageFunc
    health_and_readiness: HealthAndReadiness
    edge70_parameters: Edge70Parameters
    market_data: MarketData
  }) {
    this.logger = logger
    this.edge = edge
    this.send_message = send_message
    this.health_and_readiness = health_and_readiness
    this.market_data = market_data
    this.signal_publisher = new TypedGenericTopicPublisher<Edge70Signal>({
      logger,
      event_name: "Edge70Signal",
      health_and_readiness,
    })
    this.publisher_for_EdgeDirectionSignal = new EdgeDirectionSignalPublisher({
      logger,
      dogstatsd,
      health_and_readiness,
    })
  }

  async init(): Promise<void> {
    await this.signal_publisher.connect()
    await this.publisher_for_EdgeDirectionSignal.connect()
    if (this.market_data) await this.market_data.init()
  }

  async publish(args: Edge70Signal): Promise<void> {
    let { direction } = args
    let { base_asset, symbol } = args.market_identifier
    let { edge } = this
    let tags = { edge, base_asset, direction, symbol }

    /* Event decorators - MCAP etc */
    try {
      if (this.market_data) {
        // This can happen - we don't have data for all coins on Binance
        let CoinGeckoMarketData: CoinGeckoMarketData | undefined = this.market_data.market_data(
          args.market_identifier
        )
        if (CoinGeckoMarketData) {
          args.extra = { ...args.extra, CoinGeckoMarketData }
          let market_data_string: string = this.market_data.market_data_string(CoinGeckoMarketData) || ""
          args.msg = args.msg + ` ${market_data_string}`
        }
      }
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }

    /* telegram */
    let direction_string = direction === "long" ? "LONG ⬆" : "SHORT ⬇"
    let msg = `signal ${edge.toUpperCase()} ${direction_string} ${base_asset} (${symbol})`
    this.logger.info(tags, msg)
    this.send_message(msg, tags)

    try {
      this.logger.debug(tags, `Publishing Edge70Signal for ${args.market_identifier.base_asset}`)
      await this.signal_publisher.publish(args)
    } catch (err) {
      this.logger.warn(tags, `Failed to publish ${args.object_type} to AMQP for ${symbol}`)
      this.logger.error({ err })
      Sentry.captureException(err)
    }

    try {
      await this.publish_direction_to_amqp({
        signal_timestamp_ms: args.signal.signal_timestamp_ms,
        market_identifier: args.market_identifier,
        direction,
      })
    } catch (err) {
      this.logger.warn(tags, `Failed to publish direction to AMQP for ${symbol}`)
      this.logger.error({ err })
      Sentry.captureException(err)
    }
  }

  private async publish_direction_to_amqp({
    direction,
    market_identifier,
    signal_timestamp_ms,
  }: {
    direction: "long" | "short"
    signal_timestamp_ms: number
    market_identifier: MarketIdentifier_V5
  }) {
    let { edge } = this
    let { base_asset } = market_identifier
    let event: EdgeDirectionSignal = {
      object_type: "EdgeDirectionSignal",
      object_class: "event",
      version: 1,
      edge,
      msg: `${base_asset} ${direction} signal`,
      market_identifier,
      direction,
      exchange_type: market_identifier.exchange_identifier.exchange_type,
      base_asset: market_identifier.base_asset,
      quote_asset: market_identifier.quote_asset,
      symbol: market_identifier.symbol,
      signal_timestamp_ms: signal_timestamp_ms,
    }
    let tags = { base_asset, edge }
    this.logger.event(tags, event)
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    await this.publisher_for_EdgeDirectionSignal.publish(event, options)
  }
}
