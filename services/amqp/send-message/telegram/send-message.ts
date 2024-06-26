import { URL } from "url"
import fetch from "node-fetch"
import { ServiceLogger } from "../../../../interfaces/logger"
import Sentry from "../../../../lib/sentry"
import { ContextTags } from "../../../../interfaces/send-message"

export class SendMessage {
  private logger: ServiceLogger

  constructor({ logger }: { logger: ServiceLogger }) {
    this.logger = logger
  }

  private get_chat_id(tags?: ContextTags): string {
    if (tags?.edge === "edge61") return "-682031175"
    if (tags?.edge === "edge60" || tags?.edge === "edge70") return "-795241615"
    if (tags?.edge === "edge62") return "-781625968"
    return process.env.TELEGRAM_CHAT_ID as string
  }

  async send_message(ack_func: () => void, service_name: string, message: string, tags: ContextTags = {}) {
    let event = {
      object_type: "SendMessage",
      object_class: "event" as "event",
      msg: message || "(null)",
      service_name,
    }
    this.logger.event(tags, event)

    /* Check for blank message */
    if (!message) {
      this.logger.event(
        { ...tags, level: "error" },
        { ...event, object_type: "BlankSendMessage", object_class: "event" }
      )
      ack_func()
      return
    }

    /* check for messages that are too long and break them up */
    let split_index = 4000
    if (message.length > split_index) {
      // 4096
      let m1 = message.slice(0, split_index)
      let remainder = message.slice(split_index)
      this.logger.object(tags, {
        object_type: "SplitSendMessage",
        msg: `Split messge, M1 size ${m1.length}, remainder ${remainder.length}`,
      })
      let fake_ack = () => {
        return
      }
      await this.send_message(fake_ack, service_name, m1, tags)
      await this.send_message(ack_func, service_name, remainder, tags)
      return
    }

    try {
      const url = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_KEY}/sendMessage`)
      url.searchParams.append("chat_id", this.get_chat_id(tags))
      url.searchParams.append("text", `${service_name}: ${message}`)
      let response = await fetch(url)
      if (response.status == 429) {
        // https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this
        Sentry.captureException(new Error(`Hit rate limit on telegram API (429)`))
        this.logger.warn(`Hit rate limit on telegram API (429)`)
        setTimeout(this.send_message.bind(this, ack_func, service_name, message, tags), 1000 * 61)
        return
      }
      if (response.status != 200) {
        this.logger.error({ res: response })
        this.logger.error(JSON.stringify(response))
        this.logger.error(await response.json())
        throw new Error(`Response status code from telegram api: ${response.status} ${response.statusText}`)
      }
      // Success, let's ACK the event
      // TODO: actually this isn't a great model as the messages go to different channels and so
      // are rate limited separately - this code will prevent one channels messages getting delivered if
      // any channel is getting rate limited
      // What if we had multiple consumers on a queue? How does AMQP handle multiple consumers?
      // Is suppose this service could split up into different queues and have a handler for each of those
      // queues to forward to telegram
      ack_func()
    } catch (err) {
      // few things throw
      this.logger.exception(tags, err)
    }
  }
}
