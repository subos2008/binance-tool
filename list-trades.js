require("dotenv").config();

// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations

const redis = require("redis").createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

const { promisify } = require("util");
const keysAsync = promisify(redis.keys).bind(redis);
const getAsync = promisify(redis.get).bind(redis);
const hgetallAsync = promisify(redis.hgetall).bind(redis);

async function main() {
  const keys = await keysAsync("trades:*:completed");
  // console.log(keys);
  for (const key of keys) {
    if ((await getAsync(key)) !== "true") {
      const trade_id = key.match(/trades:(\d+):completed/)[1];
      const foo = await hgetallAsync(`trades:${trade_id}:trade_definition`);
      const flags = []
      if(foo["soft_entry"]) flags.push("soft_entry")
      if(foo["auto_size"]) flags.push("auto_size")
      console.log(`Trade ${trade_id}: ${foo.pair}: ${foo.stop_price} ${foo.buy_price} ${foo.target_price} ${flags.join(' ')}`);
    }
  }
  redis.quit();
}
main();
