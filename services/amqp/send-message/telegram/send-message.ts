import { URL } from "url"
import fetch from "node-fetch"
import { ContextTags, SendMessageFunc } from "../../../../classes/send_message/publish"
import { Logger } from "../../../../interfaces/logger"
import Sentry from "../../../../lib/sentry"

export class SendMessage {
  private logger: Logger

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  private get_chat_id(tags?: ContextTags): string {
    if (tags?.edge === "edge61") return "-682031175"
    if (tags?.edge === "edge60") return "-795241615"
    if (tags?.edge === "edge62") return "-781625968"
    return process.env.TELEGRAM_CHAT_ID as string
  }

  func(service_name: string): SendMessageFunc {
    return this.send_message.bind(this, service_name)
  }

  async send_message(service_name: string, message: string, _tags?: ContextTags) {
    let tags: any = _tags || {}
    tags.object_type = "SendMessage"
    this.logger.info(tags, message)
    try {
      const url = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_KEY}/sendMessage`)
      url.searchParams.append("chat_id", this.get_chat_id(tags))
      url.searchParams.append("text", `${service_name}: ${message}`)
      let response = await fetch(url)
      if (response.status == 429) {
        // https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this
        Sentry.captureException(new Error(`Hit rate limit on telegram API (429)`))
        this.logger.warn(`Hit rate limit on telegram API (429)`)
        setTimeout(this.send_message.bind(this, message, tags), 1000 * 60)
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
