"use strict"

import { bind } from "lodash"
import { URL } from "url"
import { Logger } from "../interfaces/logger"

import fetch from "node-fetch"
import { ContextTags, SendMessageFunc } from "../interfaces/send-message"
import Sentry from "./sentry"

export class SendMessage {
  service_name: string
  logger: Logger
  constructor({ service_name, logger }: { service_name: string; logger: Logger }) {
    this.service_name = service_name
    this.logger = logger
  }

  build(): SendMessageFunc {
    if (!process.env.TELEGRAM_KEY || !process.env.TELEGRAM_CHAT_ID) {
      this.logger.error("Telegram message delivery not configured.")
      throw new Error(`TELEGRAM_KEY and/or TELEGRAM_CHAT_ID not set`)
    }
    return bind(this.send_message, this)
  }

  get_chat_id(tags?: ContextTags): string {
    if (tags?.edge === "edge61") return "-682031175"
    if (tags?.edge === "edge60") return "-795241615"
    if (tags?.edge === "edge62") return "-781625968"
    if (tags?.edge === "edge63") return "-795241615"
    return process.env.TELEGRAM_CHAT_ID as string
  }

  async send_message(message: string, _tags?: ContextTags) {
    let tags: any = _tags || {}
    tags.object_type = "SendMessage"
    this.logger.info(tags, message)
    try {
      const url = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_KEY}/sendMessage`)
      url.searchParams.append("chat_id", this.get_chat_id(tags))
      url.searchParams.append("text", `${this.service_name}: ${message}`)
      let response = await fetch(url)
      if (response.status == 429) {
        // https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this
        Sentry.captureException(new Error(`Hit rate limit on telegram API (429)`))
        this.logger.warn(`Hit rate limit on telegram API (429)`)
        setTimeout(this.send_message.bind(this, message, tags), 1000 * 60)
        return
      }
      if (response.status != 200) {
        throw new Error(`Response status code from telegram api: ${response.status} ${response.statusText}`)
      }
    } catch (err) {
      // few things throw
      Sentry.captureException(err)
      this.logger.error({ err })
    }
  }
}
