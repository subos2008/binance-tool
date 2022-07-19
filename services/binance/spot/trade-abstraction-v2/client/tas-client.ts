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
Sentry.configureScope(function (scope: any) {
  scope.setTag("class", "TradeAbstractionServiceClient")
})

function sleep(seconds: number) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}
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
    let response = await this._call("GET", new URL("/exchange_identifier", this.TAS_URL).toString())
    this.logger.info(`Returned exchange_identifier:`)
    this.logger.object(response)
    return response
  }

  async prices(): Promise<BinanceStyleSpotPrices> {
    let response = await this._call("GET", new URL("/prices", this.TAS_URL).toString())
    this.logger.info(`Returned prices:`)
    this.logger.object(response)
    return response
  }

  async positions(): Promise<SpotPositionIdentifier_V3[]> {
    let response = await this._call("GET", new URL("/positions", this.TAS_URL).toString())
    this.logger.info(`Returned positions:`)
    this.logger.object(response)
    return response
  }

  async close(cmd: TradeAbstractionCloseCommand): Promise<TradeAbstractionCloseResult> {
    let tas_response: TradeAbstractionCloseResult | undefined
    // do {
    let response = await this.get(new URL("/close", this.TAS_URL).toString(), cmd)
    this.logger.object(response)
    tas_response = response.data as TradeAbstractionCloseResult
    // TODO: need to return something if we get bullshit back, throw right
    if (tas_response?.object_type !== "TradeAbstractionCloseResult")
      throw new Error(`Unexpected result, expected object_type 'TradeAbstractionCloseResult`)
    // } while (tas_response.http_status === 429) // TODO
    return tas_response
  }

  async long(cmd: TradeAbstractionOpenLongCommand): Promise<TradeAbstractionOpenLongResult> {
    let tas_response: TradeAbstractionOpenLongResult | undefined
    do {
      let response = await this.get(new URL("/long", this.TAS_URL).toString(), cmd)
      this.logger.object(response)
      tas_response = response.data as TradeAbstractionOpenLongResult
      // TODO: need to return something if we get bullshit back, throw right
      if (tas_response?.object_type !== "TradeAbstractionOpenLongResult") {
        let err = new Error(`Unexpected result, expected object_type 'TradeAbstractionOpenLongResult`)
        Sentry.captureException(err, { contexts: { tas_response: { tas_response } } })
        throw err
      }
      try {
        if (tas_response.http_status === 429) {
          let seconds = Number(response.headers["retry-after"] || "0")
          this.logger.warn(`429 from TAS, retrying in ${seconds} seconds`)
          await sleep(seconds)
        }
      } catch (err) {
        Sentry.captureException(err)
        this.logger.error({ err })
      }
    } while (tas_response.http_status === 429)
    return tas_response
  }

  async short(cmd: TradeAbstractionOpenShortCommand): Promise<TradeAbstractionOpenShortResult> {
    let tas_response: TradeAbstractionOpenShortResult | undefined
    // do {
    let response = await this.get(new URL("/short", this.TAS_URL).toString(), cmd)
    this.logger.object(response)
    tas_response = response.data as TradeAbstractionOpenShortResult
    // TODO: need to return something if we get bullshit back, throw right
    if (tas_response?.object_type !== "TradeAbstractionOpenShortResult")
      throw new Error(`Unexpected result, expected object_type 'TradeAbstractionOpenLongResult`)
    // } while (tas_response.http_status === 429) // TODO
    return tas_response
  }

  /**
   * @private Make a HTTP request to a specific endpoint. Private endpoints are automatically signed.
   */
  private async _call(method: Method, endpoint: string, params?: string | object): Promise<any> {
    try {
      const options: AxiosRequestConfig = {
        url: endpoint,
        timeout: 10 * 1000, // ms, 1000 = 1 second
        headers: {},
        method: method,
        transformResponse: (res: string) => {
          // Do your own parsing here if needed ie JSON.parse(res);
          return JSONBigNumber.parse(res)
        },
        // json: false, // avoid parsing json with the built in libs as they use floating point numbers
        params,
        validateStatus: (status) => status < 500,
      }

      let response = await axios(options)
      return response.data
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err })
      throw err
    }
  }

  private async get(endpoint: string, params?: string | object): Promise<AxiosResponse<any, any>> {
    try {
      const options: AxiosRequestConfig = {
        timeout: 10 * 1000, // ms, 1000 = 1 second
        headers: {},
        transformResponse: (res: string) => {
          // Do your own parsing here if needed ie JSON.parse(res);
          return JSONBigNumber.parse(res)
        },
        // json: false, // avoid parsing json with the built in libs as they use floating point numbers
        params,
        validateStatus: (status) => status < 500,
      }

      let response = await axios.get(endpoint, options)
      return response
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err })
      throw err
    }
  }
}
