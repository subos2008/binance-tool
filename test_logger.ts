#!./node_modules/.bin/ts-node

import { Logger } from "./lib/faux_logger"
import { Logger as LoggerInterface } from "./interfaces/logger"
const logger: LoggerInterface = new Logger({ silent: false })

logger.info("just a plain message")

logger.info({ hello: "just a tags object" })

logger.info({ err: new Error("an error sans message") })

logger.info({ err: new Error("an error with a message") }, "do you see this?")

logger.event({}, { object_type: "object_type", msg: "This is a msg" })
let event = { object_type: "object_type", message: "This is a message" }
logger.event({}, event)
