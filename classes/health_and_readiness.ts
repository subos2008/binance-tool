import { Logger } from "../interfaces/logger"
import { SendMessageFunc } from "../lib/telegram-v2"

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
      if (value) {
        this.logger.info(
          { class: "HealthAndReadiness", subsystem: this.name, transition: "ready" },
          `Subsystem ${this.name} became ready`
        )
        this._ready = value
      } else {
        let transition = value ? `ready` : `not ready`
        this.logger.warn(
          { class: "HealthAndReadiness", subsystem: this.name, transition },
          `Subsystem ${this.name} became ${transition}`
        )
      }
    }
    return this._ready
  }

  // if argument is undefined this is a read, if non-null sets and returns
  healthy(value?: boolean | undefined): boolean {
    if (typeof value === "undefined") return this._healthy
    if (value != this._healthy) {
      if (value) {
        this.logger.info(`Subsystem ${this.name} became ${value ? `healthy` : `not healthy`}`)
      } else {
        this.logger.warn(`Subsystem ${this.name} became ${value ? `healthy` : `not healthy`}`)
      }
      try {
        if (!value) this.send_message(`subsystem ${this.name} became unhealthy`, { class: "HealthAndReadiness" })
      } catch (e) {
        this.logger.error(`unable to send_message to report service as going unhealthy`)
      }
    }
    return this._healthy
  }
}

export class HealthAndReadiness {
  logger: Logger
  send_message: SendMessageFunc
  subsystems: { [id: string]: HealthAndReadinessSubsystem } = {}

  constructor({ logger, send_message }: { logger: Logger; send_message: SendMessageFunc }) {
    this.logger = logger
    this.send_message = send_message || logger.info.bind(logger)
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
      throw new Error(`Attempting to add already existing subsystem '${name}' to HealthAndReadiness'`)
    }

    return new HealthAndReadinessSubsystem({
      parent: this,
      logger: this.logger,
      send_message: this.send_message,
      name,
      healthy,
      ready,
    })
  }

  surmise_state_to_logger() {
    this.logger.warn(`HealthAndReadiness status:`)
    for (const key in this.subsystems) {
      this.logger.warn(
        `${key}: healthy: ${this.subsystems[key].healthy()}, ready: ${this.subsystems[key].ready()}`
      )
    }
  }

  healthy(): boolean {
    let healthy = !Object.values(this.subsystems)
      .map((x) => x.healthy())
      .includes(false)
    if (!healthy) this.surmise_state_to_logger()
    return healthy
  }

  ready(): boolean {
    let ready = !Object.values(this.subsystems)
      .map((x) => x.ready())
      .includes(false)
    if (!ready) this.surmise_state_to_logger()
    return ready
  }
}
