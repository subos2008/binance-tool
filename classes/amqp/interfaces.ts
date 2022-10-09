// TODO: is there a type for an event?

import { Channel, Message } from "amqplib"

export interface RawAMQPMessageProcessor {
  process_message: (raw_amqp_message: Message, channel: Channel) => Promise<void>
}

export interface TypedMessageProcessor<EventT> {
  process_message: (event: EventT, channel: Channel, raw_amqp_message: Message) => Promise<void>
}
