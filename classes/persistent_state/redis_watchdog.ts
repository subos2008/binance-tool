import { strict as assert } from 'assert';
const { promisify } = require("util");

import { Logger } from '../../interfaces/logger'
import { RedisClient } from 'redis';

export class RedisWatchdog {
  logger: Logger;
  redis: RedisClient;
  watchdog_name: string;
  timeout_seconds: number
  set_redis_key: any;
  timeout_obj: any

  constructor({ logger, redis, watchdog_name, timeout_seconds }: { logger: Logger, redis: RedisClient, watchdog_name: string, timeout_seconds: number }) {
    assert(logger);
    this.logger = logger;
    assert(redis);
    this.redis = redis;
    assert(watchdog_name);
    this.watchdog_name = watchdog_name;
    assert(timeout_seconds);
    this.timeout_seconds = timeout_seconds;

    this.set_redis_key = promisify(this.redis.set).bind(this.redis);

    console.log(`Created redis watchdog for ${this.watchdog_name} expiring at ${this.timeout_seconds}, redis key '${this.get_key()}'`)
    this._reset_timer()
  }

  get_key() {
    return `watchdogs:${this.watchdog_name}`;
  }

  async reset(): Promise<void> {
    const result = await this.set_redis_key(this.get_key(), Date.now(), 'EX', this.timeout_seconds)
    if (result !== "OK") {
      this.logger.warn(`Setting redis watchdog failed: ${result}`)
    }
  }

  async reset_subsystem(subsystem_name: string): Promise<void> {
    const result = await this.set_redis_key(`${this.get_key()}:${subsystem_name}`, Date.now(), 'EX', this.timeout_seconds)
    if (result !== "OK") {
      this.logger.warn(`Setting redis watchdog failed: ${result}`)
    }
  }

  _reset_timer() {
    if (this.timeout_obj) {
      clearTimeout(this.timeout_obj);
      this.timeout_obj = null
    }
    this.timeout_obj = setTimeout(() => {
      console.error(`Watchdog timer ${this.watchdog_name} expired!`);
    }, this.timeout_seconds * 1000);
    this.timeout_obj.unref() // stop the watchdog from keeping the process alive
  }
}
