export type MyEventNameType =
  | "InternalConnectivityTestEvent"
  | "SpotPortfolio"
  | "Edge56EntrySignal"
  | "BinanceOrderData"
  | "FuturesBinanceOrderData"
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
          headers: {},
        }

      case "Edge56EntrySignal":
        return {
          routing_key: "edge56",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: {},
        }

      case "Edge60EntrySignal":
        return {
          routing_key: "edge60",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: {},
        }

      case "Edge70Signal":
        return {
          routing_key: "edge70-signal",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: {},
        }

      case "Edge61EntrySignal":
        return {
          routing_key: "edge61",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: {},
        }

      case "EdgeDirectionSignal":
        return {
          routing_key: "edge-direction-signals",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: {},
        }

      case "BinanceOrderData": // BinanceOrderDataPublisher
        return {
          routing_key: "spot-binance-orders",
          exchange_name: "binance-tool",
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
          headers: {},
        }
      case "SpotPositionOpened":
        return {
          routing_key: "spot-positions",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: {},
        }
      case "SpotPositionClosed":
        return {
          routing_key: "spot-positions",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: {},
        }

      case "SendMessageEvent":
        return {
          routing_key: "send-message",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
          headers: {},
        }

      default:
        throw new Error(`Routing not defined for event_name: ${event_name}`)
    }
  }
}
