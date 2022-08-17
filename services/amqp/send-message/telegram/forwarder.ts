import { SendMessageEvent } from "../../../../classes/send_message/publish"
import { SendMessage } from "./send-message"
import { ServiceLogger } from "../../../../interfaces/logger"
import { TypedMessageProcessor } from "../../../../classes/amqp/interfaces"
import { Channel, Message } from "amqplib"

export class SendMessageToTelegramForwarder implements TypedMessageProcessor<SendMessageEvent> {
  send_message: SendMessage
  logger: ServiceLogger

  constructor({ send_message, logger }: { send_message: SendMessage; logger: ServiceLogger }) {
    this.logger = logger
    this.send_message = send_message
  }

  async process_message(event: SendMessageEvent, channel: Channel, raw_amqp_message: Message) {
    let ack_func: () => void = channel.ack.bind(channel, raw_amqp_message)
    return this.send_message.send_message(ack_func, event.service_name, event.msg, event.tags)
  }
}
