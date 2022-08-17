import { ServiceLogger } from "../interfaces/logger"
import { BunyanServiceLogger } from "../lib/service-logger"

let logger: ServiceLogger = new BunyanServiceLogger()

logger.info(`Hello from .info without tags!`)

logger.info({ base_asset: "INFO" }, `Hello from .info with tags!`)

logger.event({ base_asset: "EVENT" }, { object_type: "TEST_EVENT", msg: `Hello from .info with tags!` })
