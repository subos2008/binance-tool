// TODO: is there a type for an event?

import { Channel } from "amqplib"

// TODO: <T> type this for the type of message body recieved?
export interface MessageProcessor {
  process_message: (event: any, channel: Channel) => Promise<void>
}
