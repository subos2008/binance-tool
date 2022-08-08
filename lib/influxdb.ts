// Configuration
const dotenv = require("dotenv")
dotenv.config({ path: "../.env" })
// End Config

const url = process.env.INFLUXDB_HOST
const token = process.env.INFLUXDB_TOKEN
const orgid = process.env.INFLUXDB_ORG_ID
const bucket = process.env.INFLUXDB_BUCKET || "binance-tool"

import { strict as assert } from 'assert';

assert(url)
assert(token)
assert(orgid)
assert(bucket)

import { InfluxDB, HttpError, Point } from "@influxdata/influxdb-client"
// You can generate a Token from the "Tokens Tab" in the UI
const writeApi = new InfluxDB({ url, token }).getWriteApi(orgid, bucket, "s")

async function write(line: string) {
  writeApi.writeRecord(line)
  writeApi.flush()
}

async function writePoint(point: Point) {
  writeApi.writePoint(point)
  writeApi.flush()
}

export default { write, flush_and_close, writePoint }

async function flush_and_close() {
  // flush pending writes and close writeApi
  try {
    await writeApi.close()
    console.log("Closed InfluxDB connection.")
  } catch (e) {
    console.error(e)
    if (e instanceof HttpError && e.statusCode === 401) {
      console.log("Run ./onboarding.js to setup a new InfluxDB database.")
    }
    console.log("\nFinished ERROR")
    throw e
  }
}

// Example write
// const line = 'mem,host=host1 used_percent=23.43234543 1556896326' // Line protocol string
