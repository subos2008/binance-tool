import { SendMessageEvent } from "../../../../classes/send_message/publish"
import { SendMessageCallback } from "../send-message-listener"
import { SendMessage } from "./send-message"
import { Logger } from "../../../../interfaces/logger"
import { Channel } from "amqplib"

export class SendMessageToTelegramForwarder implements SendMessageCallback {
  send_message: SendMessage
  logger: Logger

  constructor({ send_message, logger }: { send_message: SendMessage; logger: Logger }) {
    this.logger = logger
    this.send_message = send_message
  }

  async processSendMessageEvent(event: SendMessageEvent, ack_func: () => void): Promise<void> {
    return this.send_message.send_message(ack_func, event.service_name, event.msg, event.tags)
  }
}
