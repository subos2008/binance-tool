# Binance Spot Execution Reports to AMQP

For a long time we had a BinanceOrderData type. However, when moving positions-tracker and other systems to use GenericOrderData we realised BinanceOrderData was a needless middle class.

Probably we should rename `GenericOrderData` to `GenericOrderData` before it gets too popular - I beleive that naming tweak came in in Binance's futures API.

The underlying datatype from Binance (spot) is ExecutionReport:

```typescript
    switch (this.exchange_identifier.type) {
      case "spot":
        this.closeUserWebsocket = await this.ee.ws.user(
          async (
            data: OutboundAccountInfo | ExecutionReport | BalanceUpdate | OutboundAccountPosition | MarginCall
          ) => {
            this.logger.info(data)
            if (data.eventType === "executionReport") {
              process_execution_report(data)
            }
          }
        )
        break
      default:
        throw new Error(`Unknown exchange type: ${this.exchange_identifier.type}`)
    }
  }
```

We process the Binance ExecutionReports to AMQP so they can be queued and logged. The queuing code is a lightweight as possible helps ensure the incomming messages have the highest chance of getting queued.

## Published Messages & Routing

We are moving to namespacing and isolating the exchange specific messages and porting all the (spot) services to use exchange neutral (termed: `Generic`) datatypes.

It would make sense to use our own isolated RabbitMQ exchange for exchange specific queues. Indeed this could be where we break the monolithic repo rule.

At the minimum let's start with routing keys that contain `binance` and `spot`, so this could be `binance.spot.ExecutionReport`

We queue the `binance.spot.ExecutionReport` events to get the data out of the web socket and into a resulient queue as fast as possible. There is *no processing* done on the `ExecutionReport` before it is queued so there is a little code as possible for bugs and the `ws` ingestion is *horizontally scaled* so that we don't risk loosing any ingestion during deploy.

## Caveats - Danger Will Robinson

_*Note: The ingestion and publishing services may not make any effort to prevent duplicate messages. This means the consumers of `binance.spot.ExecutionReport` messages need to do the de-duplication*_

_Messages might also be out-of-order as queuing requires us to choose between unprocessable messages blocking the entire system *or* causing out-of-order messages *or* being completed disgarded_ 
