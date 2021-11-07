// TODO: is there a type for an event?
// TODO: <T> type this for the type of message body recieved?
export interface MessageProcessor {
  process_message: (event: any) => Promise<void>
}
