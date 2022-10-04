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
  | "SendMessage"

export class MessageRouting {
  static amqp_routing({ event_name }: { event_name: MyEventNameType }): {
    routing_key: string
    exchange_name: string
    exchange_type: "topic"
    durable: false
  } {
    switch (event_name) {
      case "InternalConnectivityTestEvent":
        return {
          routing_key: "connectivity-test-events",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }

      case "SpotPortfolio":
        return {
          routing_key: "portfolio",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }

      case "Edge56EntrySignal":
        return {
          routing_key: "edge56",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }

      case "Edge60EntrySignal":
        return {
          routing_key: "edge60",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }

      case "Edge70Signal":
        return {
          routing_key: "edge70-signal",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }

      case "Edge61EntrySignal":
        return {
          routing_key: "edge61",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }

      case "EdgeDirectionSignal":
        return {
          routing_key: "edge-direction-signals",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }

      case "BinanceOrderData": // BinanceOrderDataPublisher
        return {
          routing_key: "spot-binance-orders",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }
      case "FuturesBinanceOrderData":
        return {
          routing_key: "futures-binance-order-data",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }
      case "SpotPositionOpened":
        return {
          routing_key: "spot-positions",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }
      case "SpotPositionClosed":
        return {
          routing_key: "spot-positions",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }

      case "SendMessage":
        return {
          routing_key: "send-message",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }

      default:
        throw new Error(`Routing not defined for event_name: ${event_name}`)
    }
  }
}
