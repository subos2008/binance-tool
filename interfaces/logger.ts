// NB: made it mandatory to supply a tags object as the first arg,

import { ContextTags } from "./send-message"

//  err is a special tag for passing exceptions
export interface Logger {
  info(tags: Object, ...message: any[]): void
  error(tags: Object, ...message: any[]): void
  fatal(tags: Object, ...message: any[]): void
  warn(tags: Object, ...message: any[]): void
  debug(tags: Object, ...message: any[]): void
  silly(tags: Object, ...message: any[]): void
  event(tags: ContextTags, event: LoggableEvent): void
}

export interface LoggableEvent {
  object_type: string
  msg?: string
}
export interface ServiceLogger {
  info(tags: Object, ...message: any[]): void
  error(tags: Object, ...message: any[]): void
  fatal(tags: Object, ...message: any[]): void
  warn(tags: Object, ...message: any[]): void
  debug(tags: Object, ...message: any[]): void
  silly(tags: Object, ...message: any[]): void
  exception(tags: ContextTags, err: unknown, msg?: string): void
  event(tags: ContextTags, event: LoggableEvent): void
}
