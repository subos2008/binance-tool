# Dynamic vs Exchange Implemented Stops

Key: Exchange Implemented Stops means stops that the exchange supports, Dynamic means we have to run code to continually update the stops on the exchange and/or generate our own Exit signals.

Exchanges support vastly different stops technology - especially when we consider trading on spot exchanges. For long term edges not paying the swap fee might make sense. Or using spot might have different tax calculations - no idea.

# KISS 

If we use stops that are re-calculated daily (say based on ATR on the daily candles + an inital fixed percentage stop) then it's easy to use heartbeats to make sure the Dynamic stop re-calculation is happening. 

Stops based on each tick are hard to backtest/test as we need tick data to test them.

It's much easier to backtest/test something that just has one fixed stop price at each given daily candle.  No profit target, open ended profit, and one stop price.

# Backtesting and Edge Performance Tracking

We assume the edge code wants to detect all it's own exit conditions so it can be used as a backtester.

This also allows the Edge code to generate performance data when live trading without relying on the Trading Engine code to actually enter positions. i.e. if portfolio becomes fully allocated.

## Edge Code API

Having an API/ABI/Interface the Edge code plugs into that allows it to be tested and used as either a live Edge or backtester seems ideal.

We might want to use a harness that allows us to use Python for performance analysis.

So: `Candles Data` -> `Blackbox` -> `Data File of Trades/Signals` -> `Python Performance Analysis`

Moved to [Backtesting Architecture](docs/missives/backtesting-architecture.md).
