"use strict"

import { bind } from "lodash"
import { URL } from "url"
import { Logger } from "../interfaces/logger"

const fetch = require("node-fetch")
const Sentry = require("@sentry/node")

export class SendMessage {
  service_name: string
  logger: Logger
  constructor({ service_name, logger }: { service_name: string; logger: Logger }) {
    this.service_name = service_name
    this.logger = logger
  }

  build(): (msg: string) => Promise<void> {
    if (!process.env.TELEGRAM_KEY || !process.env.TELEGRAM_CHAT_ID) {
      this.logger.error("Telegram message delivery not configured.")
      throw new Error(`TELEGRAM_KEY and/or TELEGRAM_CHAT_ID not set`)
    }
    return bind((message: string) => {
      this.logger.info(message)
      try {
        const url = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_KEY}/sendMessage`)
        url.searchParams.append("chat_id", process.env.TELEGRAM_CHAT_ID as string)
        url.searchParams.append("text", `${this.service_name}: ${message}`)
        return fetch(url)
      } catch (error) {
        Sentry.captureException(error)
        this.logger.error(error)
      }
    }, this)
  }
}
