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
  const redis: RedisClientType = createClient({
    url: `redis://:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}`,
    // retry_strategy: redis_retry_strategy,
  })

  redis.on("error", function (err: any) {
    logger.warn("Redis.on errror handler called")
    logger.error(err.stack)
    logger.error(err)
    Sentry.withScope(function (scope: any) {
      scope.setTag("location", "redis-global-error-handler")
      Sentry.captureException(err)
    })
  })

  redis.on("ready", function () {
    let obj = { object_type: "RedisConnectionStatus", ready: true, REDIS_HOST: process.env.REDIS_HOST }
    logger.object(obj)
    health_and_readiness.ready(true)
    health_and_readiness.healthy(true)
  })

  redis.on("error", function (err: any) {
    let obj = { object_type: "RedisConnectionStatus", ready: false, REDIS_HOST: process.env.REDIS_HOST }
    logger.error(`Redis disconnected: ${err.toString()}`)
    logger.object(obj)
    health_and_readiness.healthy(false)
  })

  redis.on("end", function () {
    let obj = { object_type: "RedisConnectionStatus", ready: false, REDIS_HOST: process.env.REDIS_HOST }
    logger.error(`Redis disconnected co-operatively`)
    logger.object(obj)
    health_and_readiness.healthy(false)
  })

  await redis.connect()

  return redis
}
