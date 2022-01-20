const TAS_URL = process.env.TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}
if (!TAS_URL.startsWith("http")) {
  throw new Error("TRADE_ABSTRACTION_SERVICE_URL should contain http/s!")
}

import axios, { AxiosRequestConfig, AxiosResponse, Method } from "axios"
import { Logger } from "../../../interfaces/logger"
import { SpotPositionIdentifier } from "../spot-interfaces"
import { TradeAbstractionCloseLongCommand, TradeAbstractionOpenLongCommand } from "../trade-abstraction-service"
const JSONBigNumber = require("./JSONBigNumber")

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("class", "SpotTradeAbstractionServiceClient")
})

export class SpotTradeAbstractionServiceClient {
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  async positions(): Promise<SpotPositionIdentifier[]> {
    let response = await this._call("GET", new URL("/positions", TAS_URL).toString())
    console.log(`Returned positions:`)
    console.log(response)
    return response
  }

  async open_spot_long(cmd: TradeAbstractionOpenLongCommand): Promise<string> {
    let response = await this._call("GET", new URL("/spot/long", TAS_URL).toString(), cmd)
    console.log(`Returned open_spot_long:`)
    console.log(response)
    return response
  }

  async close_spot_long(cmd: TradeAbstractionCloseLongCommand): Promise<string> {
    let response = await this._call("GET", new URL("/spot/close", TAS_URL).toString(), cmd)
    console.log(`Returned close_spot_long:`)
    console.log(response)
    return response
  }

  /**
   * @private Make a HTTP request to a specific endpoint. Private endpoints are automatically signed.
   */
  async _call(method: Method, endpoint: string, params?: string | object): Promise<any> {
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

    try {
      let response = await axios(options)
      if (response.status == 200) {
        return response.data
      }
      throw response
    } catch (error) {
      Sentry.captureException(error)
      this.logger.error(error)
      throw error
    }
  }
}
