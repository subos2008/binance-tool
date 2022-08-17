// TODO: is there a type for an event?

import { Channel, Message } from "amqplib"

// TODO: <T> type this for the type of message body recieved?
export interface MessageProcessor {
  process_message: (event: any, channel: Channel) => Promise<void>
}

export interface RawAMQPMessageProcessor {
  process_message: (event: Message, channel: Channel) => Promise<void>
}

export interface TypedMessageProcessor<EventT> {
  process_message: (event: EventT, channel: Channel, raw_amqp_message: Message) => Promise<void>
}
