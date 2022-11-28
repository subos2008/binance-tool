// NB: made it mandatory to supply a tags object as the first arg,

import { ContextTags } from "./send-message"

// Depricated
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

export interface Command extends LoggableEvent {
  object_class: "command"
}

export interface Result extends LoggableEvent {
  object_class: "result"
}

export interface PureEvent extends LoggableEvent {
  object_class: "event"
}

export interface TODO extends LoggableEvent {
  object_type: "TODO"
}

// forwarded means just getting logged as it passes through the system
// consumed means final destination reached
export type Lifecycle = "created" | "forwarded" | "received" | "consumed"

export interface ServiceLogger {
  info(tags: Object, ...message: any[]): void
  error(tags: Object, ...message: any[]): void
  fatal(tags: Object, ...message: any[]): void
  warn(tags: Object, ...message: any[]): void
  debug(tags: Object, ...message: any[]): void
  silly(tags: Object, ...message: any[]): void
  exception(tags: ContextTags, err: unknown, msg?: string): void
  event(tags: ContextTags, event: PureEvent): void
  todo(tags: ContextTags, msg: string): void

  /* Special objects that get created and consumed */
  command(tags: ContextTags, event: Command, lifecycle: Lifecycle): void
  result(tags: ContextTags, event: Result, lifecycle: Lifecycle): void
}
