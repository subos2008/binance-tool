import { SendMessageEvent } from "../../../../classes/send_message/publish"
import { SendMessageCallback } from "../send-message-listener"
import { SendMessage } from "./send-message"
import { Logger } from "../../../../interfaces/logger"

export class SendMessageToTelegramForwarder implements SendMessageCallback {
  send_message: SendMessage
  logger: Logger

  constructor({ send_message, logger }: { send_message: SendMessage; logger: Logger }) {
    this.logger = logger
    this.send_message = send_message
  }

  async processSendMessageEvent(event: SendMessageEvent): Promise<void> {
    return this.send_message.send_message(event.service_name, event.msg, event.tags)
  }
}
