# Trade Abstraction Service

We want something with a simple interface we can call from edge long/short signals.

Allowing us to keep the following code from being repeated in edge signals bots:
1. Position Sizing
1. Persistant Positions Tracking
1. Execution of Orders on the Market

However, currently the entry/exit for each edge is hardcoded in the execution logic.


## Ideas

1. Per-edge trading rules (stops, position_size) - could even be a class

## Tests

### With Spot Execution

1. Get a long signal, check we have a position and a stop at the end
1. Get a short signal, check the stop order is cancelled and we have exited the position



TAS -> TradeAbstractionService ->
  ee: BinanceSpotExecutionEngine
  spot_ee: SpotPositionsExecution(ee:BinanceSpotExecutionEngine)
    -> SpotPositionsExecution_StopLimitExit(ee)
    -> SpotPositionsExecution_OCOExit
