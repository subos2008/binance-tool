import { strict as assert } from 'assert';
const { promisify } = require("util");

import { Logger } from '../../interfaces/logger'
import { RedisClient } from 'redis';

import * as Sentry from '@sentry/node';

export class RedisWatchdog {
  logger: Logger;
  redis: RedisClient;
  watchdog_name: string;
  timeout_seconds: number
  set_redis_key: any;
  timeout_objs: any

  constructor({ logger, redis, watchdog_name, timeout_seconds }: { logger: Logger, redis: RedisClient, watchdog_name: string, timeout_seconds: number }) {
    assert(logger);
    this.logger = logger;
    assert(redis);
    this.redis = redis;
    assert(watchdog_name);
    this.watchdog_name = watchdog_name;
    assert(timeout_seconds);
    this.timeout_seconds = timeout_seconds;
    this.timeout_objs = {}

    this.set_redis_key = promisify(this.redis.set).bind(this.redis);

    console.log(`Created redis watchdog for ${this.watchdog_name} expiring each ${this.timeout_seconds} seconds, redis key '${this.get_key()}'`)
    // set a timeout that will make an entry in the logs but don't create the key in redis
    // this is beacuse we don't want a process that continually restarts without a ping to look
    // healthy in redis
    this._reset_timer("default")
  }

  get_key() {
    return `watchdogs:${this.watchdog_name}`;
  }

  async reset(): Promise<void> {
    const result = await this.set_redis_key(this.get_key(), Date.now(), 'EX', this.timeout_seconds)
    if (result !== "OK") {
      this.logger.warn(`Setting redis watchdog failed: ${result}`)
    }
    this._reset_timer("default")
  }

  async reset_subsystem(subsystem_name: string): Promise<void> {
    const result = await this.set_redis_key(`${this.get_key()}:${subsystem_name}`, Date.now(), 'EX', this.timeout_seconds)
    if (result !== "OK") {
      this.logger.warn(`Setting redis watchdog failed: ${result}`)
    }
    this._reset_timer(subsystem_name)

  }

  _reset_timer(subsystem: string) {
    if (this.timeout_objs[subsystem]) {
      clearTimeout(this.timeout_objs[subsystem]);
      this.timeout_objs[subsystem] = null
    }
    this.timeout_objs[subsystem] = setTimeout(() => {
      console.error(`Watchdog timer ${this.watchdog_name}:${subsystem} expired!`);
      Sentry.withScope(function (scope: any) {
        scope.setTag("location", "redis-watchdog-expiry");
        scope.setTag("watchdog-subsystem", subsystem);
        Sentry.captureMessage(`Watchdog timer expired`);
      });
    }, this.timeout_seconds * 1000);
    this.timeout_objs[subsystem].unref() // stop the watchdog from keeping the process alive
  }
}
