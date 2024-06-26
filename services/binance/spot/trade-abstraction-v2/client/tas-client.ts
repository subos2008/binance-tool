import axios, { AxiosRequestConfig, AxiosResponse, Method } from "axios"
import { ServiceLogger } from "../../../../../interfaces/logger"
import { TradeAbstractionMoveStopCommand, TradeAbstractionMoveStopResult } from "../interfaces/move_stop"
import { TradeAbstractionOpenLongCommand, TradeAbstractionOpenLongResult } from "../interfaces/long"
import { TradeAbstractionCloseCommand, TradeAbstractionCloseResult } from "../interfaces/close"
import { URL } from "url"

import {
  BinanceStyleSpotPrices,
  SpotPositionIdentifier_V3,
} from "../../../../../classes/spot/abstractions/position-identifier"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../../../events/shared/exchange-identifier"
import Sentry from "../../../../../lib/sentry"
import { AxiosRetry } from "./axios-retry"
import { ContextTags, TradeContextTags } from "../../../../../interfaces/send-message"
Sentry.configureScope(function (scope: any) {
  scope.setTag("class", "TradeAbstractionServiceClient")
})

export class TradeAbstractionServiceClient {
  logger: ServiceLogger
  TAS_URL: string

  // Let TAS_URL be undefined because we check it here
  constructor({ logger, TAS_URL }: { logger: ServiceLogger; TAS_URL: string | undefined }) {
    this.logger = logger

    if (TAS_URL === undefined) {
      throw new Error("TAS_URL must be provided!")
    }
    if (!TAS_URL.startsWith("http")) {
      throw new Error("TAS_URL should contain http/s!")
    }

    this.TAS_URL = TAS_URL
  }

  async get_exchange_identifier(): Promise<ExchangeIdentifier_V4> {
    let response = await this.get(new URL("/exchange_identifier", this.TAS_URL).toString())
    // this.logger.event({}, response.data) // exchange_identifier
    return response.data
  }

  async prices(): Promise<BinanceStyleSpotPrices> {
    let response = await this.get(new URL("/prices", this.TAS_URL).toString())
    return response.data
  }

  async positions(): Promise<SpotPositionIdentifier_V3[]> {
    let response = await this.get(new URL("/positions", this.TAS_URL).toString())
    return response.data
  }

  async close(cmd: TradeAbstractionCloseCommand): Promise<TradeAbstractionCloseResult> {
    let tags = { edge: cmd.edge, base_asset: cmd.base_asset }
    try {
      let response = await this.get(new URL("/close", this.TAS_URL).toString(), cmd)
      this.logger.info(response)
      let tas_response = response.data as TradeAbstractionCloseResult
      if (tas_response?.object_type !== "TradeAbstractionCloseResult") {
        let err = new Error(`Unexpected result, expected object_type 'TradeAbstractionCloseResult`)
        this.logger.exception(tags, err)
        Sentry.captureException(err, { contexts: { tas_response: { tas_response } } })
      }
      return tas_response
    } catch (err) {
      this.logger.exception(tags, err)
      throw err
    }
  }

  async long(cmd: TradeAbstractionOpenLongCommand): Promise<TradeAbstractionOpenLongResult> {
    let tags: TradeContextTags = { edge: cmd.edge, base_asset: cmd.base_asset, trade_id: cmd.trade_id }
    try {
      let response = await this.get(new URL("/long", this.TAS_URL).toString(), cmd)
      this.logger.info(response)
      let tas_response = response.data as TradeAbstractionOpenLongResult
      if (tas_response?.object_type !== "TradeAbstractionOpenLongResult") {
        let err = new Error(`Unexpected result, expected object_type 'TradeAbstractionOpenLongResult`)
        this.logger.exception(tags, err)
        Sentry.captureException(err, { contexts: { tas_response: { tas_response } } })
      }
      return tas_response
    } catch (err) {
      this.logger.exception(tags, err)
      throw err
    }
  }

  async move_stop(cmd: TradeAbstractionMoveStopCommand): Promise<TradeAbstractionMoveStopResult> {
    let { base_asset, edge } = cmd.trade_context
    let tags: ContextTags = { base_asset, edge }
    try {
      let response = await this.get(new URL("/move_stop", this.TAS_URL).toString(), cmd)
      this.logger.info(response)
      let tas_response = response.data as TradeAbstractionMoveStopResult
      if (tas_response?.object_type !== "TradeAbstractionMoveStopResult") {
        let err = new Error(
          `Unexpected result, expected object_type 'TradeAbstractionMoveStopResult' got '${tas_response?.object_type}'`
        )
        this.logger.exception(tags, err)
        Sentry.captureException(err, { contexts: { tas_response: { tas_response } } })
      }
      return tas_response
    } catch (err) {
      this.logger.exception(tags, err)
      throw err
    }
  }

  private async get(endpoint: string, params?: string | object): Promise<AxiosResponse<any, any>> {
    let axios_retry = new AxiosRetry({ logger: this.logger })
    let response = await axios_retry.get(endpoint, params)
    return response
  }
}
