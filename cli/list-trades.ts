#!./node_modules/.bin/ts-node

require("dotenv").config();

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
  let trade_ids = keys.map((key: any) => parseInt(key.match(/:(\d+):/)[1])).sort((a: any, b: any) => a - b)
  let sorted_keys = trade_ids.map((id: any) => `trades:${id}:completed`)
  for (const key of sorted_keys) {
    const completed = (await getAsync(key)) === "true";
    const trade_id = key.match(/trades:(\d+):completed/)[1];
    const foo = await hgetallAsync(`trades:${trade_id}:trade_definition`);
    const flags = [];
    if (foo["soft_entry"]) flags.push("soft_entry");
    if (foo["auto_size"]) flags.push("auto_size");
    console.log(
      `${completed ? " " : "A"} Trade ${trade_id}: ${foo.pair}: ${
      foo.stop_price
      } ${foo.buy_price} ${foo.target_price} ${flags.join(" ")}`
    );
  }
  redis.quit();
}
main();
