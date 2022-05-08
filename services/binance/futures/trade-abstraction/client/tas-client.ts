const TAS_URL = process.env.SPOT_TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("SPOT_TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}
if (!TAS_URL.startsWith("http")) {
  throw new Error("SPOT_TRADE_ABSTRACTION_SERVICE_URL should contain http/s!")
}

import axios, { AxiosRequestConfig, AxiosResponse, Method } from "axios"
import { Logger } from "../../../interfaces/logger"
import { TradeAbstractionOpenSpotLongCommand, TradeAbstractionOpenSpotLongResult } from "../interfaces/open_spot"
import { TradeAbstractionCloseLongCommand, TradeAbstractionCloseSpotLongResult } from "../interfaces/close_spot"

const JSONBigNumber = require("./JSONBigNumber")
import { URL } from "url"

import * as Sentry from "@sentry/node"
import { SpotPositionIdentifier_V3 } from "../../../classes/spot/abstractions/position-identifier"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("class", "SpotTradeAbstractionServiceClient")
})

export class SpotTradeAbstractionServiceClient {
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  async positions(): Promise<SpotPositionIdentifier_V3[]> {
    let response = await this._call("GET", new URL("/positions", TAS_URL).toString())
    this.logger.info(`Returned positions:`)
    this.logger.object(response)
    return response
  }

  async open_spot_long(cmd: TradeAbstractionOpenSpotLongCommand): Promise<TradeAbstractionOpenSpotLongResult> {
    let response = await this._call("GET", new URL("/spot/long", TAS_URL).toString(), cmd)
    return response
  }

  async close_spot_long(cmd: TradeAbstractionCloseLongCommand): Promise<TradeAbstractionCloseSpotLongResult> {
    let response = await this._call("GET", new URL("/spot/close", TAS_URL).toString(), cmd)
    this.logger.object(response)
    return response
  }

  /**
   * @private Make a HTTP request to a specific endpoint. Private endpoints are automatically signed.
   */
  private async _call(method: Method, endpoint: string, params?: string | object): Promise<any> {
    try {
      const options = {
        url: endpoint,
        timeout: 10 * 1000, // ms, 1000 = 1 second
        headers: {},
        method: method,
        transformResponse: (res: string) => {
          // Do your own parsing here if needed ie JSON.parse(res);
          return JSONBigNumber.parse(res)
        },
        json: false, // avoid parsing json with the built in libs as they use floating point numbers
        params,
      }

      let response = await axios(options)
      return response.data
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err })
      throw err
    }
  }
}