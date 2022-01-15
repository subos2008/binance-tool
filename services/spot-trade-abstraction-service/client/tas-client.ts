const TAS_URL = process.env.TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}
if (!TAS_URL.startsWith("http")) {
  throw new Error("TRADE_ABSTRACTION_SERVICE_URL should contain http/s!")
}

import axios, { AxiosRequestConfig, AxiosResponse, Method } from "axios"
import { Logger } from "../../../interfaces/logger"
const JSONBigNumber = require("./JSONBigNumber")

export class SpotTradeAbstractionServiceClient {
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  async positions() {
    let response = this._call("GET", new URL("/positions", TAS_URL).toString())
    return response
  }

  /**
   * @private Make a HTTP request to a specific endpoint. Private endpoints are automatically signed.
   */

  async _call(method: Method, endpoint: string, params?: string | object): Promise<any> {
    const options = {
      headers: {},
      method: method,
      transformResponse: (res: string) => {
        // Do your own parsing here if needed ie JSON.parse(res);
        return JSONBigNumber.parse(res)
      },
      json: false, // avoid parsing json with the built in libs as they use floating point numbers
    }

    if (method === "GET") {
      // const serialisedParams = serializeParamPayload(isGetRequest, params, this.options.strict_param_validation)
      // options.url += serialisedParams
    } else {
      // options.data = params
    }

    return axios(options).then((response) => {
      if (response.status == 200) {
        return response.data
      }

      throw response
    })
    // .catch((e) => this.parseException(e))
  }
}
