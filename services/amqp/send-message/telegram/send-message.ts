import { URL } from "url"
import fetch from "node-fetch"
import { ContextTags, SendMessageFunc } from "../../../../classes/send_message/publish"
import { Logger } from "../../../../interfaces/logger"
import Sentry from "../../../../lib/sentry"
import { Channel } from "amqplib"

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

  async send_message(ack_func: () => void, service_name: string, message: string, _tags?: ContextTags) {
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
        setTimeout(this.send_message.bind(this, ack_func, message, tags), 1000 * 61)
        return
      }
      if (response.status != 200) {
        throw new Error(`Response status code from telegram api: ${response.status} ${response.statusText}`)
      }
      // Success, let's ACK the event
      // TODO: actually this isn't a great model as the events go to different channels and so
      // are rate limited separately - this code will prevent one channels messages getting delivered if
      // any channel is getting rate limited
      // What if we had multiple consumers on a queue? How does AMQP handle multiple consumers?
      // Is suppose this service could split up into different queues and have a handler for each of those
      // queues to forward to telegram
      ack_func()
    } catch (err) {
      // few things throw
      Sentry.captureException(err)
      this.logger.error({ err })
    }
  }
}
