import axios, { AxiosRequestConfig, AxiosResponse, Method } from "axios"
import { Logger } from "../../../../../interfaces/logger"
import { TradeAbstractionOpenLongCommand, TradeAbstractionOpenLongResult } from "../interfaces/long"
import { TradeAbstractionOpenShortCommand, TradeAbstractionOpenShortResult } from "../interfaces/short"
import { TradeAbstractionCloseCommand, TradeAbstractionCloseResult } from "../interfaces/close"

const JSONBigNumber = require("./JSONBigNumber")
import { URL } from "url"

import {
  BinanceStyleSpotPrices,
  SpotPositionIdentifier_V3,
} from "../../../../../classes/spot/abstractions/position-identifier"
import { ExchangeIdentifier_V3 } from "../../../../../events/shared/exchange-identifier"
import Sentry from "../../../../../lib/sentry"
import { AxiosRetry } from "./axios-retry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("class", "TradeAbstractionServiceClient")
})

export class TradeAbstractionServiceClient {
  logger: Logger
  TAS_URL: string

  // Let TAS_URL be undefined because we check it here
  constructor({ logger, TAS_URL }: { logger: Logger; TAS_URL: string | undefined }) {
    this.logger = logger

    if (TAS_URL === undefined) {
      throw new Error("TAS_URL must be provided!")
    }
    if (!TAS_URL.startsWith("http")) {
      throw new Error("TAS_URL should contain http/s!")
    }

    this.TAS_URL = TAS_URL
  }

  async get_exchange_identifier(): Promise<ExchangeIdentifier_V3> {
    let response = await this.get(new URL("/exchange_identifier", this.TAS_URL).toString())
    this.logger.info(`Returned exchange_identifier:`)
    this.logger.info({ res: response })
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
    let response = await this.get(new URL("/close", this.TAS_URL).toString(), cmd)
    this.logger.info({ res: response })
    let tas_response = response.data as TradeAbstractionCloseResult
    if (tas_response?.object_type !== "TradeAbstractionCloseResult") {
      let err = new Error(`Unexpected result, expected object_type 'TradeAbstractionCloseResult`)
      this.logger.error({ err })
      Sentry.captureException(err, { contexts: { tas_response: { tas_response } } })
    }
    return tas_response
  }

  async long(cmd: TradeAbstractionOpenLongCommand): Promise<TradeAbstractionOpenLongResult> {
    let response = await this.get(new URL("/long", this.TAS_URL).toString(), cmd)
    this.logger.info({ res: response })
    let tas_response = response.data as TradeAbstractionOpenLongResult
    if (tas_response?.object_type !== "TradeAbstractionOpenLongResult") {
      let err = new Error(`Unexpected result, expected object_type 'TradeAbstractionOpenLongResult`)
      this.logger.error({ err })
      Sentry.captureException(err, { contexts: { tas_response: { tas_response } } })
    }
    return tas_response
  }

  async short(cmd: TradeAbstractionOpenShortCommand): Promise<TradeAbstractionOpenShortResult> {
    let response = await this.get(new URL("/short", this.TAS_URL).toString(), cmd)
    this.logger.info({ res: response })
    let tas_response = response.data as TradeAbstractionOpenShortResult
    if (tas_response?.object_type !== "TradeAbstractionOpenShortResult") {
      let err = new Error(`Unexpected result, expected object_type 'TradeAbstractionOpenShortResult`)
      Sentry.captureException(err, { contexts: { tas_response: { tas_response } } })
      this.logger.error({ err })
    }
    return tas_response
  }

  private async get(endpoint: string, params?: string | object): Promise<AxiosResponse<any, any>> {
    let axios_retry = new AxiosRetry({ logger: this.logger })
    let response = await axios_retry.get(endpoint, params)
    return response
  }
}
