import { GenericTopicPublisher } from "../../../../classes/amqp/generic-publishers"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { SpotPositionCallbacks, SpotPositionClosedEvent_V1, SpotPositionOpenedEvent_V1 } from "../../../../classes/spot/abstractions/spot-position-callbacks"
import { Logger } from "../../../../lib/faux_logger"

export class SpotPositionPublisher implements SpotPositionCallbacks {
  logger: Logger
  publisher_opened: GenericTopicPublisher
  publisher_closed: GenericTopicPublisher
  health_and_readiness: HealthAndReadiness

  constructor({ logger, health_and_readiness }: { logger: Logger; health_and_readiness: HealthAndReadiness }) {
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.publisher_opened = new GenericTopicPublisher({
      logger,
      event_name: "SpotPositionOpened",
      health_and_readiness,
    })
    this.publisher_closed = new GenericTopicPublisher({
      logger,
      event_name: "SpotPositionClosed",
      health_and_readiness,
    })
  }

  async connect(): Promise<void> {
    await this.publisher_opened.connect()
    await this.publisher_closed.connect()
  }

  async on_position_opened(event: SpotPositionOpenedEvent_V1): Promise<void> {
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    await this.publisher_opened.publish(event, options)
  }

  async on_position_closed(event: SpotPositionClosedEvent_V1): Promise<void> {
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    await this.publisher_closed.publish(event, options)
  }

  async shutdown_streams() {
    if (this.publisher_opened) this.publisher_opened.shutdown_streams()
    if (this.publisher_closed) this.publisher_closed.shutdown_streams()
  }
}
