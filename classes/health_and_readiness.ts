import { Logger } from "../interfaces/logger"
import { Request, Response } from "express"
import Sentry from "../lib/sentry"
import { randomUUID } from "crypto"
import { ContextTags, SendMessageFunc } from "../interfaces/send-message"

type Summary = { [subsystem: string]: boolean | string }
type HealthAndReadinessChange = {
  object_type: "HealthAndReadinessChange"
  subsystem: string
  value: boolean
  transition: "healthy" | "ready"
}

export class HealthAndReadinessSubsystem {
  logger: Logger
  send_message: SendMessageFunc
  private _ready: boolean
  private _healthy: boolean
  parent: HealthAndReadiness
  name: string

  constructor({
    parent,
    logger,
    send_message,
    name,
    healthy,
    ready,
  }: {
    parent: HealthAndReadiness
    logger: Logger
    send_message: SendMessageFunc
    name: string
    healthy: boolean
    ready: boolean
  }) {
    this.parent = parent
    this.logger = logger
    this.name = name
    this.send_message = send_message
    this._healthy = healthy
    this._ready = ready
  }

  // if argument is undefined this is a read, if non-null sets and returns
  ready(value?: boolean | undefined): boolean {
    if (typeof value === "undefined") return this._ready
    if (value != this._ready) {
      let event: HealthAndReadinessChange = {
        object_type: "HealthAndReadinessChange",
        subsystem: this.name,
        transition: "ready",
        value,
      }
      this.logger.object(event)
      if (!value) this.send_message(`subsystem ${this.name} became not ready`, { class: "HealthAndReadiness" })
    }
    this._ready = value
    return this._ready
  }

  // if argument is undefined this is a read, if non-null sets and returns
  healthy(value?: boolean | undefined): boolean {
    if (typeof value === "undefined") return this._healthy
    if (value != this._healthy) {
      let event: HealthAndReadinessChange = {
        object_type: "HealthAndReadinessChange",
        subsystem: this.name,
        transition: "healthy",
        value,
      }
      this.logger.object(event)
      if (!value) this.send_message(`subsystem ${this.name} became unhealthy`, { class: "HealthAndReadiness" })
    }
    this._healthy = value
    return this._healthy
  }
}

export class HealthAndReadiness {
  logger: Logger
  send_message: SendMessageFunc
  subsystems: { [id: string]: HealthAndReadinessSubsystem } = {}

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
    /* can't use norma SendMessage because that uses AMQP and need H&R... */
    let foo: SendMessageFunc = async (msg: string, tags?: ContextTags) => {
      if (tags) this.logger.info(tags, msg)
      else this.logger.info(msg)
    }
    this.send_message = foo
  }

  addSubsystem({
    name,
    ready,
    healthy,
  }: {
    name: string
    ready: boolean
    healthy: boolean
  }): HealthAndReadinessSubsystem {
    this.logger.info(`Registering new subsystem: ${name}, starting defaults: ready: ${ready}, healthy:${healthy}`)
    if (name in this.subsystems) {
      // check for subsystem already exists)
      this.logger.warn(`Attempting to add already existing subsystem '${name}' to HealthAndReadiness'`)
      name = `${name}-${randomUUID()}`
    }

    this.subsystems[name] = new HealthAndReadinessSubsystem({
      parent: this,
      logger: this.logger,
      send_message: this.send_message,
      name,
      healthy,
      ready,
    })

    return this.subsystems[name]
  }

  surmise_health_state(): Summary {
    let result: { [subsystem: string]: boolean } = {}
    for (const subsystem in this.subsystems) {
      result[subsystem] = this.subsystems[subsystem].healthy()
    }
    return { object_type: "ReadinessSummary", ...result }
  }

  surmise_readiness_state(): Summary {
    let result: { [subsystem: string]: boolean } = {}
    for (const subsystem in this.subsystems) {
      result[subsystem] = this.subsystems[subsystem].ready()
    }
    return { object_type: "HealthSummary", ...result }
  }

  surmise_state_to_logger() {
    let event = {
      object_type: "HealthAndReadinessFailed",
      health_summary: this.surmise_health_state(),
      readiness_summary: this.surmise_readiness_state(),
    }
    this.logger.warn(JSON.stringify(event))
    for (const key in this.subsystems) {
      this.logger.warn(
        `${key}: healthy: ${this.subsystems[key].healthy()}, ready: ${this.subsystems[key].ready()}`
      )
    }
  }

  health_handler(req: Request, res: Response) {
    let summary: Summary = this.surmise_health_state()
    if (this.healthy()) {
      res.send({ status: "OK", summary })
    } else {
      this.logger.warn(summary)
      res.status(500).json({ status: "UNHEALTHY", summary })
    }
  }

  readiness_handler(req: Request, res: Response) {
    let summary: Summary = this.surmise_readiness_state()
    if (this.ready()) {
      res.send({ status: "OK", summary })
    } else {
      this.logger.warn(summary)
      res.status(500).json({ status: "UNHEALTHY", summary })
    }
  }

  healthy(): boolean {
    let subsystems = Object.values(this.subsystems)
    if (subsystems.length === 0) this.logger.warn(`/healthy on service with no registered subsystems`)
    let healthy = !subsystems.map((x) => x.healthy()).includes(false)
    if (!healthy) this.surmise_state_to_logger()
    return healthy
  }

  ready(): boolean {
    let subsystems = Object.values(this.subsystems)
    if (subsystems.length === 0) this.logger.warn(`/ready on service with no registered subsystems`)
    let ready = !subsystems.map((x) => x.ready()).includes(false)
    if (!ready) this.surmise_state_to_logger()
    return ready
  }
}
