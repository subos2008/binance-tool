/**
 * Usage patterns:
 *
 * logger.event(tags,obj) // don't pass separate tags when logging an object
 * logger.info({err}) // { err => err } invokes special internal handlers
 * logger.info({err}, msg)
 * logger.info(tags, msg) // Add tags to a string msg
 * logger.info({...tags, ...obj}) // log an object with tags by merging them
 *
 * Do not:
 * Pass both tags and an object, merge them into an object - or call .event(tags, obj)
 *
 */

/**
 * Bunyan supported call interface:
 *
 * log.info();     // Returns a boolean: is the "info" level enabled?
 *                 // This is equivalent to `log.isInfoEnabled()` or
 *                 // `log.isEnabledFor(INFO)` in log4j.
 *
 * log.info('hi');                     // Log a simple string message (or number).
 * log.info('hi %s', bob, anotherVar); // Uses `util.format` for msg formatting.
 *
 * log.info({foo: 'bar'}, 'hi');
 *                 // The first field can optionally be a "fields" object, which
 *                 // is merged into the log record.
 *
 * log.info(err);  // Special case to log an `Error` instance to the record.
 *                 // This adds an "err" field with exception details
 *                 // (including the stack) and sets "msg" to the exception
 *                 // message.
 * log.info(err, 'more on this: %s', more);
 *                 // ... or you can specify the "msg".
 *
 * log.info({foo: 'bar', err: err}, 'some msg about this error');
 *                 // To pass in an Error *and* other fields, use the `err`
 *                 // field name for the Error instance **and ensure your logger
 *                 // has a `err` serializer.** One way to ensure the latter is:
 *                 //      var log = bunyan.createLogger({
 *                 //          ...,
 *                 //          serializers: bunyan.stdSerializers
 *                 //      });
 *                 // See the "Serializers" section below for details.
 */

import * as bunyan from "bunyan"

import Sentry from "./sentry"

import {
  Command,
  Lifecycle,
  LoggableEvent,
  Logger,
  PureEvent,
  Result,
  ServiceLogger,
  TODO,
} from "../interfaces/logger"
import { ContextTags } from "../interfaces/send-message"
import { EventMetrics } from "../interfaces/metrics"

export class BunyanServiceLogger implements ServiceLogger, Logger {
  silent: boolean
  bunyan: bunyan
  events_as_msg: boolean = false
  full_trace: boolean = false
  event_metrics: EventMetrics | undefined

  /**
   * @param {boolean} events_as_msg - Suppress printing of entire events and just print .msg. Used in the backtester where we want readable logs
   */
  constructor(
    {
      silent,
      template,
      level,
      events_as_msg,
      full_trace,
      event_metrics,
    }: {
      silent: boolean
      template?: object
      level?: bunyan.LogLevel
      events_as_msg?: boolean
      full_trace?: boolean
      event_metrics?: EventMetrics
    } = {
      silent: false,
      template: {},
    }
  ) {
    if (events_as_msg) this.events_as_msg = events_as_msg
    if (full_trace) this.full_trace = full_trace
    if (!template) template = {}
    this.event_metrics = event_metrics
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

  set_event_metrics(event_metrics: EventMetrics) {
    this.event_metrics = event_metrics
  }

  info(obj: Object, ...params: any[]) {
    if (this.full_trace && this.bunyan.info()) console.trace(`BunyanServiceLogger.info`)
    if ((obj as any).object_type) {
      console.trace(
        `logger.info used for an object_type event (${
          (obj as any).object_type
        }), consider porting to use logger.event`
      )
    }

    if (!this.silent) {
      try {
        this.bunyan.info(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  notice(obj: Object, ...params: any[]) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.notice`)
    if (!this.silent) {
      this.bunyan.info(obj, ...params)
    }
  }

  error(obj: Object, ...params: any[]) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.error`)
    if (!this.silent) {
      try {
        this.bunyan.error(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  fatal(obj: Object, ...params: any[]) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.fatal`)
    if (!this.silent) {
      try {
        this.bunyan.fatal(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  warn(obj: Object, ...params: any[]) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.warn`)
    if (!this.silent) {
      try {
        this.bunyan.warn(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  debug(obj: Object, ...params: any[]) {
    if (this.full_trace && this.bunyan.debug()) console.trace(`BunyanServiceLogger.debug`)
    if (!this.silent) {
      try {
        this.bunyan.debug(obj, ...params)
      } catch (err) {
        Sentry.captureException(err)
      }
    }
  }

  silly(obj: Object, ...params: any[]) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.silly`)
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
   *
   * Supplied msg will be used if msg is not present in exception. msg is also
   * backed up and passed through as msg2.
   */
  exception(tags: ContextTags, err: unknown, msg?: string) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.exception`)
    try {
      let _err = err as any
      this.bunyan.error({ object_type: "Exception", ...tags, msg, msg2: msg, err: _err })
      Sentry.captureException(err)
    } catch (err) {
      console.error(`Failed to log exception:`)
      console.error(err)
      Sentry.captureException(err)
    }
  }

  object(tags: ContextTags, event: LoggableEvent) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.event call stack trace`)
    if (!this.silent) {
      try {
        // Used in the backtester where we want readable logs
        if (this.events_as_msg) {
          if (event.msg) {
            this.bunyan.info(tags, `[${event.object_type}] ${event.msg}`)
          } else {
            console.trace(`[${event.object_type}] missing @msg attribute`)
            this.bunyan.info({ ...tags, ...event })
          }
          return
        }

        // Default case handling
        this.call_bunyan_by_level_name(tags.level || "info", { ...tags, ...event }, event.msg)
      } catch (err) {
        console.error(err)
        Sentry.captureException(err)
      }
    }
  }

  event(tags: ContextTags, event: PureEvent) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.event call stack trace`)
    if (!this.silent) {
      try {
        // Used in the backtester where we want readable logs
        if (this.events_as_msg) {
          if (event.msg) {
            this.bunyan.info(tags, `[${event.object_type}] ${event.msg}`)
          } else {
            console.trace(`[${event.object_type}] missing @msg attribute`)
            this.bunyan.info({ ...tags, ...event })
          }
          return
        }

        // Default case handling
        this.call_bunyan_by_level_name(tags.level || "info", { ...tags, ...event }, event.msg)
      } catch (err) {
        console.error(err)
        Sentry.captureException(err)
      }
    }
  }

  command(tags: ContextTags, event: Command, lifecycle: Lifecycle) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.command call stack trace`)
    if (this.silent) return
    try {
      this.call_bunyan_by_level_name(tags.level || "info", { ...tags, ...event, lifecycle }, event.msg)
    } catch (err) {
      console.error(err)
      Sentry.captureException(err)
    }
  }

  result(tags: ContextTags, event: Result, lifecycle: Lifecycle) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.result call stack trace`)
    if (this.silent) return
    try {
      this.call_bunyan_by_level_name(tags.level || "info", { ...tags, ...event, lifecycle }, event.msg)
    } catch (err) {
      console.error(err)
      Sentry.captureException(err)
    }
    if (this.event_metrics) {
      this.event_metrics.result({ event, lifecycle }).catch((err) => this.exception(tags, err))
    }
  }

  todo(tags: ContextTags, msg: string) {
    if (this.full_trace) console.trace(`BunyanServiceLogger.todo call stack trace`)
    if (this.silent) return
    let event: TODO = { object_type: "TODO", msg }
    try {
      this.call_bunyan_by_level_name(tags.level || "info", { ...tags, ...event }, event.msg)
    } catch (err) {
      console.error(err)
      Sentry.captureException(err)
    }
  }

  private call_bunyan_by_level_name(level: bunyan.LogLevelString, obj: Object, ...params: any[]) {
    try {
      this.bunyan[level](obj, ...params)
    } catch (err) {
      Sentry.captureException(err)
      this.bunyan.error("Error - exception when calling call_bunyan_by_level_name")
      this.bunyan.error(err)
      this.bunyan.error(obj, ...params)
    }
  }
}
