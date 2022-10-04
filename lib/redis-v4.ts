import Sentry from "./sentry"
import { Logger } from "../interfaces/logger"
import { createClient, RedisClientType } from "redis-v4"
import { HealthAndReadinessSubsystem } from "../classes/health_and_readiness"

/**
 * You need to await connect on the client returned here
 */

export async function get_redis_client(
  logger: Logger,
  health_and_readiness: HealthAndReadinessSubsystem
): Promise<RedisClientType> {
  let url = `redis://:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}`

  let reconnectInvocationCounter = 0

  const redis: RedisClientType = createClient({
    url,
    // retry_strategy: redis_retry_strategy,
    socket: {
      reconnectStrategy: (retries) => {
        reconnectInvocationCounter++

        if (retries < 5) {
          return 0
        }

        return new Error("No more retries remaining, giving up.")
      },
    },
  })

  redis.on("ready", function () {
    let obj = { object_type: "RedisConnectionStatus", ready: true, REDIS_HOST: process.env.REDIS_HOST }
    logger.event({}, obj)
    health_and_readiness.ready(true)
    health_and_readiness.healthy(true)
  })

  redis.on("error", function (err: any) {
    logger.error({ msg: `Redis.on error: ${err.toString()}`, err })
    let obj = { object_type: "RedisError", REDIS_HOST: process.env.REDIS_HOST, err }
    logger.event({}, obj)
    logger.warn(`Not setting redis-v4 as unhealthy on.error event`)
    health_and_readiness.healthy(false)
    Sentry.withScope(function (scope: any) {
      scope.setTag("location", "redis-global-error-handler")
      Sentry.captureException(err)
    })
  })

  redis.on("end", function () {
    let obj = { object_type: "RedisConnectionStatus", ready: false, REDIS_HOST: process.env.REDIS_HOST }
    logger.error(`Redis disconnected co-operatively`)
    logger.event({}, obj)
    health_and_readiness.healthy(false)
  })

  await redis.connect()

  return redis
}
