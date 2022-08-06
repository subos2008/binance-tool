/**
 * Usage patterns:
 *
 * logger.object(obj) // don't pass separate tags when logging an object
 * logger.info({err}) // { err => err } invokes special internal handlers
 * logger.info({err}, msg)
 * logger.info(tags, msg) // Add tags to a string msg
 * logger.info({...tags, ...obj}) // log an object with tags by merging them
 *
 * Do not:
 * Pass both tags and an object, merge them into an object
 */

import * as bunyan from "bunyan"

import Sentry from "./sentry"

import { LoggableEvent, Logger, ServiceLogger } from "../interfaces/logger"
import { ContextTags } from "../interfaces/send-message"

export class BunyanServiceLogger implements ServiceLogger, Logger {
  silent: boolean
  bunyan: bunyan
  events_as_msg: boolean = false

  /**
   * @param {boolean} events_as_msg - Suppress printing of entire events and just print .msg. Used in the backtester where we want readable logs
   */
  constructor(
    {
      silent,
      template,
      level,
      events_as_msg,
    }: { silent: boolean; template?: object; level?: bunyan.LogLevel; events_as_msg?: boolean } = {
      silent: false,
      template: {},
    }
  ) {
    if (events_as_msg) events_as_msg = events_as_msg
    if (!template) template = {}
    this.silent = silent
    let params = {
      name: "bunyan_stream_name", // Required
      level,
      // level: <level name or number>,      // Optional, see "Levels" section
      // streams: [
      //   {
      //     stream: process.stderr,
      //     level: "warn",
      //   },
      //   {
      //     stream: process.stdout,
      //     level: "info",
      //   },
      // ],
      // src: true, // slow, not for production

      // if you turn off the stdSerializers add a comment why
      serializers: bunyan.stdSerializers,

      // serializers: <serializers mapping>, // Optional, see "Serializers" section
      // src: <boolean>,                     // Optional, see "src" section

      // Any other fields are added to all log records as is.
      // foo: 'bar',
    }
    this.bunyan = bunyan.createLogger({ ...params, ...template })
  }

  object(obj: any) {
    if (!this.silent) {
      // wouldn't this just have a string msg? Yes... it does seem to work in DataDog though
      try {
        this.bunyan.info(JSON.stringify(obj))
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  info(obj: Object, ...params: any[]) {
    if (!this.silent) {
      try {
        this.bunyan.info(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  notice(obj: Object, ...params: any[]) {
    if (!this.silent) {
      this.bunyan.info(obj, ...params)
    }
  }

  error(obj: Object, ...params: any[]) {
    if (!this.silent) {
      try {
        this.bunyan.error(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  fatal(obj: Object, ...params: any[]) {
    if (!this.silent) {
      try {
        this.bunyan.fatal(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  warn(obj: Object, ...params: any[]) {
    if (!this.silent) {
      try {
        this.bunyan.warn(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  debug(obj: Object, ...params: any[]) {
    if (!this.silent) {
      try {
        this.bunyan.debug(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  silly(obj: Object, ...params: any[]) {
    if (!this.silent) {
      try {
        this.bunyan.debug(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  /**
   * Interface V2 - tags are native, more context about what we are logging.
   * Will allow us to search for and eliminate simple `msg:string` logs
   */
  exception(tags: ContextTags, err: unknown, msg?: string) {
    try {
      let _err = err as any
      this.bunyan.error({ ...tags, msg, ..._err })
      Sentry.captureException(err)
    } catch (err) {
      console.error(`Failed to log exception:`)
      console.error(err)
      Sentry.captureException(err)
    }
  }

  event(tags: ContextTags, event: LoggableEvent) {
    if (!this.silent) {
      try {
        if (this.events_as_msg) {
          if (event.msg) {
            this.bunyan.info(tags, `[${event.object_type}] event.msg`)
          } else {
            console.trace(`[${event.object_type}] missing @msg attribute`)
            this.bunyan.info({ ...tags, ...event })
          }
        } else {
          this.bunyan.info({ ...tags, ...event })
        }
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }
}
