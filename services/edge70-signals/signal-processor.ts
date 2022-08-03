/** 
 * Converts the price signals (basic long/short) into edge events
 * and passes them over to the registered publisher.
 * 
 * Note edge reversal detection is also done here - this class is very important
 * for that reason!!
 * 
 */


import Sentry from "../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Edge70SignalPublisher, LongShortSignalCallbacks } from "./interfaces/_internal"
import { Logger } from "../../lib/faux_logger"
import { BinanceExchangeInfoGetter } from "../../classes/exchanges/binance/exchange-info-getter"
import { DirectionPersistance } from "./direction-persistance"
import { SendMessageFunc } from "../../classes/send_message/publish"
import { ExchangeIdentifier_V4 } from "../../events/shared/exchange-identifier"
import { Edge70Parameters, Edge70Signal } from "./interfaces/edge70-signal"
import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { Edge70AMQPSignalPublisher } from "./publisher"

export class Edge70SignalProcessor implements LongShortSignalCallbacks {
  logger: Logger
  send_message: SendMessageFunc
  edge: "edge70"
  exchange_info_getter: BinanceExchangeInfoGetter
  direction_persistance: DirectionPersistance
  exchange_identifier: ExchangeIdentifier_V4
  signal_publisher: Edge70SignalPublisher
  health_and_readiness: HealthAndReadiness
  edge70_parameters: Edge70Parameters

  constructor({
    logger,
    edge,
    exchange_info_getter,
    direction_persistance,
    send_message,
    exchange_identifier,
    health_and_readiness,
    edge70_parameters,
  }: {
    logger: Logger
    edge: "edge70"
    exchange_info_getter: BinanceExchangeInfoGetter
    direction_persistance: DirectionPersistance
    send_message: SendMessageFunc
    exchange_identifier: ExchangeIdentifier_V4
    health_and_readiness: HealthAndReadiness
    edge70_parameters: Edge70Parameters
  }) {
    this.logger = logger
    this.edge = edge
    this.exchange_info_getter = exchange_info_getter
    this.direction_persistance = direction_persistance
    this.send_message = send_message
    this.exchange_identifier = exchange_identifier
    this.health_and_readiness = health_and_readiness
    this.edge70_parameters = edge70_parameters
    this.signal_publisher = new Edge70AMQPSignalPublisher({
      logger,
      send_message,
      health_and_readiness,
      edge,
      edge70_parameters,
    })
  }

  async connect(): Promise<void> {
    await this.signal_publisher.connect()
  }

  async base_asset_for_symbol(symbol: string): Promise<string> {
    let exchange_info = await this.exchange_info_getter.get_exchange_info()
    let symbols = exchange_info.symbols
    let match = symbols.find((s) => s.symbol === symbol)
    if (!match) throw new Error(`No match for symbol ${symbol} in exchange_info symbols`)
    return match.baseAsset
  }

  async process_long_short_signal({
    symbol,
    signal_price,
    direction,
  }: {
    symbol: string
    signal_price: BigNumber
    direction: "long" | "short"
  }): Promise<void> {
    let base_asset: string = await this.base_asset_for_symbol(symbol)
    let { edge, exchange_identifier } = this
    let tags = { edge, base_asset, direction, symbol }

    let previous_direction = await this.direction_persistance.get_direction(base_asset)
    this.direction_persistance.set_direction(base_asset, direction)

    let direction_string = direction === "long" ? "⬆ LONG" : "SHORT ⬇"
    
    if (previous_direction === null) {
      this.send_message(
        `possible ${direction_string} signal on ${base_asset} - check manually if this is a trend reversal.`,
        tags
      )
      return
    }

    let direction_change = previous_direction !== direction
    let entry_filter = direction_change
    if (entry_filter) {

      // TODO: move this deeper somewhere surely..
   

      this.signal_publisher.publish(foo)
    } else {
      this.logger.info(tags, `${symbol} ${direction} price triggered but not trend reversal`)
    }
  }
}
