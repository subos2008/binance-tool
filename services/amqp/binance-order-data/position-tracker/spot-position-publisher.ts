import { TypedGenericTopicPublisher } from "../../../../classes/amqp/typed-generic-publisher"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import {
  SpotPositionCallbacks,
  SpotPositionClosed,
  SpotPositionOpenedEvent_V1,
} from "../../../../classes/spot/abstractions/spot-position-callbacks"
import { Logger } from "../../../../interfaces/logger"

export class SpotPositionPublisher implements SpotPositionCallbacks {
  logger: Logger
  publisher_opened: TypedGenericTopicPublisher<SpotPositionOpenedEvent_V1>
  publisher_closed: TypedGenericTopicPublisher<SpotPositionClosed>
  health_and_readiness: HealthAndReadiness

  constructor({ logger, health_and_readiness }: { logger: Logger; health_and_readiness: HealthAndReadiness }) {
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.publisher_opened = new TypedGenericTopicPublisher<SpotPositionOpenedEvent_V1>({
      logger,
      event_name: "SpotPositionOpened",
      health_and_readiness,
    })
    this.publisher_closed = new TypedGenericTopicPublisher<SpotPositionClosed>({
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

  async on_position_closed(event: SpotPositionClosed): Promise<void> {
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
