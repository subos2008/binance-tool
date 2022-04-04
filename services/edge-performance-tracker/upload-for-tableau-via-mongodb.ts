import { strict as assert } from "assert"

// This index should be added to MongoDB
//
// {
//   "account_name": 1,
//   "timestamp": -1
// }

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true
BigNumber.prototype.valueOf = () => {
  throw new Error("valueOf called on BigNumber")
}

import * as Sentry from "@sentry/node"
Sentry.init({})

import { SpotEdgePerformanceEvent } from "./interfaces"

import { MongoClient, Decimal128, Timestamp } from "mongodb"

export class UploadToMongoDB {
  private client: MongoClient | null = null
  private mongodb_url: string
  private mongodb_database: string | undefined
  private mongodb_collection: string

  constructor() {
    if (!process.env.MONGODB_URL) throw new Error(`Missing MONGODB_URL`)
    // if (!process.env.MONGODB_COLLECTION) throw new Error(`Missing MONGODB_COLLECTION`)
    this.mongodb_url = process.env.MONGODB_URL
    this.mongodb_database = process.env.MONGODB_DATABASE
    this.mongodb_collection = "edge-performance-tableau" // process.env.MONGODB_COLLECTION
  }

  async get_connected_client() {
    if (this.client) return this.client
    this.client = new MongoClient(this.mongodb_url, {
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
    })
    return await this.client.connect()
  }

  async close_client_connection() {
    if (this.client) this.client.close()
    this.client = null
  }

  async ingest_event(event: SpotEdgePerformanceEvent) {
    try {
      const client = await this.get_connected_client()
      const db = client.db(this.mongodb_database)

      let obj: any = JSON.parse(JSON.stringify(event)) //clone
      if (event.abs_quote_change) obj.abs_quote_change = new Decimal128(event.abs_quote_change)
      if (event.entry_timestamp_ms) obj.entry_timestamp_ms = new Date(event.entry_timestamp_ms)
      if (event.exit_timestamp_ms) obj.exit_timestamp_ms = new Date(event.exit_timestamp_ms)

      await db.collection(this.mongodb_collection).insertOne(event)
    } catch (err) {
      console.error(err)
      throw err
    }
  }
}
