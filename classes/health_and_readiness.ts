import { Logger } from "../interfaces/logger"
import { Request, Response } from "express"
import Sentry from "../lib/sentry"
import { randomUUID } from "crypto"
import { ContextTags, SendMessageFunc } from "../interfaces/send-message"

type Summary = { [subsystem: string]: boolean }

export class HealthAndReadinessSubsystem {
  logger: Logger
  send_message: SendMessageFunc
  private _healthy: boolean
  private _initialised: boolean
  parent: HealthAndReadiness
  name: string

  constructor({
    parent,
    logger,
    send_message,
    name,
    healthy,
    initialised,
  }: {
    parent: HealthAndReadiness
    logger: Logger
    send_message: SendMessageFunc
    name: string
    healthy: boolean
    initialised: boolean
  }) {
    this.parent = parent
    this.logger = logger
    this.name = name
    this.send_message = send_message
    this._healthy = healthy
    this._initialised = initialised

    if (!healthy) {
      let obj = {
        level: "warn",
        object_type: "SubsystemInitialisedNotHealthy",
        subsystem: name,
        msg: `Subsystem ${name} initialised as unhealthy`,
      }
      // This is an antipattern - health should start true, set initialised to false instead
      this.logger.event({ level: "warn" }, obj)
    }

    if (!initialised) {
      // Normal...
      let obj = {
        object_type: "SubsystemInitialisedNotInitialised",
        subsystem: name,
        msg: `Subsystem ${name} initialised as not initialised`,
      }
      this.logger.event({}, obj)
    }
  }

  // if argument is undefined this is a read, if non-null sets and returns
  initialised(value?: boolean | undefined): boolean {
    if (typeof value === "undefined") return this._initialised
    if (value != this._initialised) {
      this._initialised = value
      if (value) {
        let obj = {
          object_type: "SubsystemBecameInitialised",
          subsystem: this.name,
          msg: `Subsystem ${this.name} became initialised.`,
          global_state: this.parent.initialised(),
        }

        if (obj.global_state) {
          obj.msg += ` All subsystems are now reporting initialised.`
          this.logger.event(
            {},
            {
              object_type: "ServiceBecameInitialised",
              msg: `Service is now fully reporting initialised`,
            }
          )
        } else {
          let summary: Summary = this.parent.surmise_initialised_state()
          let bad: string[] = Object.keys(summary).filter((k) => summary[k] === false)
          obj.msg += ` Remaining not initialised subsystems: ${bad.join(", ")}`
        }
        this.logger.event({}, obj)
      }
      if (!value) {
        // This would be a strange thing to do... would expect it to go unhealthy instead
        // otherwise we have potential race conditions setting initialised to true/false
        let obj = {
          level: "fatal",
          object_type: "SubsystemInitialisationDeteriorated",
          subsystem: this.name,
          msg: `Subsystem ${this.name} became not initialised... this is a bit unusual... should go unhealthy instead`,
        }
        this.logger.event({ level: "error" }, obj)
        this.send_message(`subsystem ${this.name} became not initialised`, { class: "HealthAndReadiness" })
      }
    }
    return this._initialised
  }

  // if argument is undefined this is a read, if non-null sets and returns
  healthy(value?: boolean | undefined): boolean {
    if (typeof value === "undefined") return this._healthy
    if (value != this._healthy) {
      this._healthy = value
      if (value) {
        let obj = {
          object_type: "SubsystemBecameHealthy",
          subsystem: this.name,
          msg: `Subsystem ${this.name} became healthy`,
          global_state: this.parent.healthy(),
        }
        if (obj.global_state) {
          obj.msg += ` All subsystems are now reporting healthy.`
          this.logger.event(
            {},
            {
              object_type: "ServiceBecameHealthy",
              msg: `Service is now fully reporting healthy`,
            }
          )
        } else {
          let summary: Summary = this.parent.surmise_health_state()
          let bad: string[] = Object.keys(summary).filter((k) => summary[k] === false)
          obj.msg += ` Remaining unhealthy subsystems: ${bad.join(", ")}`
        }
        this.logger.event({}, obj)
      }
      if (!value) {
        let obj = {
          level: "fatal",
          object_type: "SubsystemHealthDeteriorated",
          subsystem: this.name,
          msg: `Subsystem ${this.name} became not healthy`,
        }
        this.logger.event({ level: "fatal" }, obj)
        this.send_message(`subsystem ${this.name} became unhealthy`, { class: "HealthAndReadiness" })
      }
    }
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
    healthy,
    initialised,
  }: {
    name: string
    healthy: boolean
    initialised: boolean
  }): HealthAndReadinessSubsystem {
    /**
     * Add an alert if we revert from initialised to not intiialised. This is very dangerous
     * as it brings a race condition for immidiate service death. One example is lazy initialisation
     * of a publisher. k8 startupProbe time has passed, livenessProbe.failureThreshold is set to 1.
     * If a healthcheck happens while the publisher is initialising the service is killed immediately.
     *
     * ... technically we could actually detect this race condition occuring inside this class.
     */
    if (this.initialised() && !initialised) {
      this.logger.error(
        `Subsystem (${name}) requiring initialisation added after service has reported initialised! Service death race condition.`
      )
    }

    let obj = {
      object_type: `HealthAndReadinessNewSubsystem`,
      msg: `Registering new subsystem: ${name}, initialised as healthy: ${healthy}, initialised: ${initialised}`,
      healthy,
      initialised,
    }
    this.logger.event({}, obj)
    if (name in this.subsystems) {
      // check for subsystem already exists)
      this.logger.event(
        {},
        {
          object_type: `HealthAndReadinessNewSubsystem`,
          msg: `Attempting to add already existing subsystem '${name}' to HealthAndReadiness'; appending UUID.`,
        }
      )
      name = `${name}-${randomUUID()}`
    }

    this.subsystems[name] = new HealthAndReadinessSubsystem({
      parent: this,
      logger: this.logger,
      send_message: this.send_message,
      name,
      healthy,
      initialised,
    })

    return this.subsystems[name]
  }

  surmise_health_state(): Summary {
    let result: { [subsystem: string]: boolean } = {}
    for (const subsystem in this.subsystems) {
      result[subsystem] = this.subsystems[subsystem].healthy()
    }
    return result
  }

  surmise_initialised_state(): Summary {
    let result: { [subsystem: string]: boolean } = {}
    for (const subsystem in this.subsystems) {
      result[subsystem] = this.subsystems[subsystem].initialised()
    }
    return result
  }

  /**
   * Returns OK when nothing is marked as unhealthy and everything is marked as initialised
   */
  health_handler(req: Request, res: Response) {
    let initialised_summary: Summary = this.surmise_initialised_state()
    let health_summary: Summary = this.surmise_health_state()
    let summary = { initialised_summary, health_summary }
    if (this.healthy() && this.initialised()) {
      res.send({ status: "OK", summary })
    } else {
      res.status(503).json({ status: "UNHEALTHY", summary })
    }
  }

  initialised_handler(req: Request, res: Response) {
    let summary: Summary = this.surmise_initialised_state()
    if (this.initialised()) {
      res.send({ status: "OK", summary })
    } else {
      res.status(503).json({ status: "NOT_INITIALISED", summary })
    }
  }

  healthy(): boolean {
    let subsystems = Object.values(this.subsystems)
    if (subsystems.length === 0) this.logger.warn(`.healthy() on service with no registered subsystems`)
    let healthy = !subsystems.map((x) => x.healthy()).includes(false)
    return healthy
  }

  initialised(): boolean {
    let subsystems = Object.values(this.subsystems)
    if (subsystems.length === 0) this.logger.warn(`.initialised() on service with no registered subsystems`)
    let initialised = !subsystems.map((x) => x.initialised()).includes(false)
    return initialised
  }
}
