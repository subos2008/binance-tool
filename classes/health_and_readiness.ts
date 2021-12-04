import { strict as assert } from "assert"
import { Logger } from "../interfaces/logger"

import * as Sentry from "@sentry/node"
import { threadId } from "worker_threads"
import { exists } from "fs"

export class HealthAndReadinessSubsystem {
  logger: Logger
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
    send_message: (msg: string) => void
    name: string
    healthy: boolean
    ready: boolean
  }) {
    this.parent = parent
    this._healthy = healthy
    this._ready = ready
  }

  // if argument is undefined this is a read, if non-null sets and returns
  ready(value?: boolean | undefined): boolean {
    if (typeof value === "undefined") return this._ready
    if (value != this._ready)
      this.logger.warn(`Subsystem ${this.name} became ${value ? `ready` : `not ready`}`)
    return this._ready
  }

  // if argument is undefined this is a read, if non-null sets and returns
  healthy(value?: boolean | undefined): boolean {
    if (typeof value === "undefined") return this._healthy
    if (value != this._healthy)
      this.logger.warn(`Subsystem ${this.name} became ${value ? `healthy` : `not healthy`}`)
    return this._healthy  }
}

export class HealthAndReadiness {
  logger: Logger
  send_message: (msg: string) => void
  subsystems: { [id: string]: HealthAndReadinessSubsystem } = {}

  constructor({ logger, send_message }: { logger: Logger; send_message: (msg: string) => void }) {
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

  healthy() {
    return !Object.values(this.subsystems)
      .map((x) => x.healthy())
      .includes(false)
  }

  ready() {
    return !Object.values(this.subsystems)
      .map((x) => x.ready())
      .includes(false)
  }
}
