import { strict as assert } from "assert"
import express, { Request, Response } from "express"
import { BinanceExchangeInfoGetter } from "../../classes/exchanges/binance/exchange-info-getter"
import { get_redis_client } from "../../lib/redis-v4"
import { RedisClientType } from "redis-v4"
import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { ExchangeIdentifier_V4 } from "../../events/shared/exchange-identifier"
import { SendMessageFunc } from "../../interfaces/send-message"
import { BunyanServiceLogger } from "../../lib/service-logger"
import { ServiceLogger } from "../../interfaces/logger"
import { SendMessage } from "../../classes/send_message/publish"
import binance from "binance-api-node"
import { Binance } from "binance-api-node"
import { RedisSpotPositionsPersistence } from "../../classes/spot/persistence/redis-implementation/redis-spot-positions-persistance-v3"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import { RedisClient } from "redis"
import { PositionsSnapshot } from "../../classes/spot/abstractions/positions-snapshot"

export class PortfolioVsPositions {
  ee: Binance
  logger: ServiceLogger
  close_short_timeframe_candle_ws: (() => void) | undefined
  close_1d_candle_ws: (() => void) | undefined
  send_message: SendMessageFunc
  exchange_info_getter: BinanceExchangeInfoGetter
  health_and_readiness: HealthAndReadiness
  // spot_positions_query: SpotPositionsQuery

  constructor({
    ee,
    exchange_identifier,
    logger,
    send_message,
    health_and_readiness,
    redis,
  }: {
    ee: Binance
    logger: ServiceLogger
    send_message: SendMessageFunc
    health_and_readiness: HealthAndReadiness
    exchange_identifier: ExchangeIdentifier_V4
    redis: RedisClient
  }) {
    this.ee = ee
    this.logger = logger
    this.send_message = send_message
    this.send_message("service re-starting")
    this.exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
    this.health_and_readiness = health_and_readiness
    let positions_persistance = new RedisSpotPositionsPersistence({ logger, redis })
    // this.spot_positions_query = new SpotPositionsQuery({
    //   logger,
    //   positions_persistance,
    //   send_message,
    //   exchange_identifier,
    // })
  }

  async positions() {
    // let { logger, spot_positions_query, prices_getter, exchange_info_getter } = this
    // let positions_snapshot = new PositionsSnapshot({
    //   logger,
    //   spot_positions_query,
    //   prices_getter,
    //   exchange_info_getter,
    // })
    // await positions_snapshot.take_snapshot()
  }
}
