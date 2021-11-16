export type MyEventNameType = "InternalConnectivityTestEvent" | "SpotBinancePortfolio"

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

      case "SpotBinancePortfolio":
        return {
          routing_key: "connectivity-test-events",
          exchange_name: "binance-tool",
          exchange_type: "topic",
          durable: false,
        }

      default:
        throw new Error(`Routing not defined for event_name: ${event_name}`)
    }
  }
}
