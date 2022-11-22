import axios, { AxiosRequestConfig, AxiosResponse, Method } from "axios"
import JSONBigNumber from "./JSONBigNumber"
import { ServiceLogger } from "../../../../../interfaces/logger"

const default_retry_ms = 11 * 1000
function getMillisToSleep(retryHeaderString: string | undefined): number {
  if (!retryHeaderString) {
    console.warn(`429 with no retry-after header, using default wait of ${default_retry_ms} ms`)
    return default_retry_ms
  }

  let millisToSleep = Math.round(parseFloat(retryHeaderString) * 1000)
  if (isNaN(millisToSleep)) {
    millisToSleep = Math.max(0, Date.parse(retryHeaderString) - Date.now()) // untested
  }
  return millisToSleep
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class AxiosRetry {
  logger: ServiceLogger

  // Let TAS_URL be undefined because we check it here
  constructor({ logger }: { logger: ServiceLogger }) {
    this.logger = logger
  }

  async get(endpoint: string, params?: string | object): Promise<AxiosResponse<any, any>> {
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

      let response: AxiosResponse<any, any>
      do {
        response = await axios.get(endpoint, options)

        // Sleep the amount of the Retry-After if present
        if (response.status === 429) {
          let ms = getMillisToSleep(response.headers["retry-after"])
          this.logger.warn(`429 from TAS, retrying ${endpoint} in ${ms} ms`)
          await sleep(ms)
        }
      } while (response.status === 429)

      return response
    } catch (err) {
      this.logger.exception({}, err)
      throw err
    }
  }
}
