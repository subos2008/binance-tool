import Sentry from "./sentry";
import { Logger } from "../interfaces/logger";
import { RedisClient } from "redis";
var util = require('util');

var client_singleton: RedisClient | undefined
var logger: Logger

export function set_redis_logger(_logger: Logger) {
  logger = _logger
  client_singleton = undefined
}

function generate_client(logger: Logger): RedisClient {
  const redis_retry_strategy = function (options: any) {
    Sentry.withScope(function (scope: any) {
      scope.setTag("location", "redis-global-error-handler");
      scope.setExtra("options", options);
      // Sentry.captureMessage("In redis_retry_strategy.");
    });
    logger.warn('Redis retry strategy called:');
    logger.warn(util.inspect(options));

    if (options.error && options.error.code === "ECONNREFUSED") {
      // End reconnecting on a specific error and flush all commands with
      // a individual error
      return new Error("The server refused the connection");
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      Sentry.captureMessage("In redis_retry_strategy: Retry time exhausted");
      // End reconnecting after a specific timeout and flush all commands
      // with a individual error
      return new Error("Retry time exhausted");
    }
    if (options.attempt > 10) {
      Sentry.captureMessage("In redis_retry_strategy: End reconnecting with built in error");
      // End reconnecting with built in error
      return undefined;
    }
    // reconnect after
    logger.warn('Redis retry strategy called: reconnect after');
    return Math.min(options.attempt * 100, 3000);
  }

  const redis = require("redis").createClient({
    host: process.env.REDIS_HOST,
    password: process.env.REDIS_PASSWORD,
    retry_strategy: redis_retry_strategy,
  });

  redis.on('error', function (err: any) {
    logger.warn('Redis.on errror handler called');
    console.error(err.stack);
    console.error(err);
    Sentry.withScope(function (scope: any) {
      scope.setTag("location", "redis-global-error-handler");
      Sentry.captureException(err);
    });
  });

  return redis
}

export function get_redis_client() {
  if (!client_singleton) {
    client_singleton = generate_client(logger)
  }
  return client_singleton;
}
