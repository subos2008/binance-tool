export type MyEventNameType =
  | "InternalConnectivityTestEvent"
  | "BinanceOrderData" // Depricated
  | "BinanceExecutionReport" // New
  | "SpotPortfolio"
  | "Edge56EntrySignal"
  | "FuturesBinanceOrderData"
  | "GenericOrderData" // Depricated
  | "GenericOrderUpdate" // New
  | "Edge58EntrySignal"
  | "Edge60EntrySignal"
  | "Edge61EntrySignal"
  | "Edge70Signal"
  | "SpotPositionOpened"
  | "SpotPositionClosed"
  | "EdgeDirectionSignal"
  | "SendMessageEvent"

export class MessageRouting {
  static amqp_routing({ event_name }: { event_name: MyEventNameType }): {
    routing_key: string
    exchange_name: string
    exchange_type: "topic"
    durable: boolean
    headers: { [name: string]: string }
  } {
    switch (event_name) {
      case "InternalConnectivityTestEvent":
        return {
          routing_key: "connectivity-test-events",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: {},
        }

      case "SpotPortfolio":
        return {
          routing_key: "portfolio",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: { "x-queue-type": "quorum" },
        }

      case "Edge70Signal":
        return {
          routing_key: "edge70-signal",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: { "x-queue-type": "quorum" },
        }

      case "EdgeDirectionSignal":
        return {
          routing_key: "edge-direction-signals",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: { "x-queue-type": "quorum" },
        }

      case "BinanceOrderData":
        console.warn(`MessageRouting for depricated message: ${event_name}`)
        return {
          routing_key: "spot-binance-orders",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false, // This is about the exchange - needs to be re-created
          headers: { "x-queue-type": "quorum" },
        }
      case "BinanceExecutionReport":
        return {
          routing_key: "binance.spot.BinanceExecutionReport",
          exchange_name: "binance-tool", // TODO: change to binance / binance-internal / binance-ingestion
          exchange_type: "topic",
          durable: false, // This is about the exchange - needs to be re-created
          headers: { "x-queue-type": "quorum" },
        }
      case "FuturesBinanceOrderData":
        return {
          routing_key: "futures-binance-order-data",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: { "x-queue-type": "quorum" },
        }
      case "GenericOrderData":
        return {
          routing_key: "spot-generic-order-data",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: { "x-queue-type": "quorum" },
        }
      case "GenericOrderUpdate":
        return {
          routing_key: "generic.spot.GenericOrderUpdate",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: { "x-queue-type": "quorum" },
        }
      case "SpotPositionOpened":
        return {
          routing_key: "spot-positions",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: { "x-queue-type": "quorum" },
        }
      case "SpotPositionClosed":
        return {
          routing_key: "spot-positions",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: { "x-queue-type": "quorum" },
        }

      case "SendMessageEvent":
        return {
          routing_key: "send-message",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: { "x-queue-type": "quorum" },
        }

      default:
        throw new Error(`Routing not defined for event_name: ${event_name}`)
    }
  }
}
