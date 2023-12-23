# Consecutive Trade Entry Signals

This occurs when an Edge Entry signal can fire without an Exit signal immediately previously.

There is an addition edge case when initilising an edge that you might not have enough history to see when the last Exit signal was, or there may never have been an Exit signal for that edge on a given asset. Newly listed assets especially have this problem.

Reasons this is an issue:

- Backtesting / edge performance
  - Do we want to add to positions when we get another entry signal
  - given trading starts on a specific date when do we allow the first entry. For example if an asset had been signalling entry multiple times we would be *entering in the middle of a trade*.
- Ensuring Trade exit tracking
  - Many edges have dynamic stops. The Edge code needs to know which of the entry signals has actually been entered as a position because it's important to track and generate Exit signals for positions that have been entered.
- Pruning Trade Exit tracking
  - A given symbol might give many Entry signals over time. We probably don't want to track all of them and canlutale the trade exit signals for every entry signal - we probably want to prune the number of entry signals down to trades we actually entered
- Mismatches
  - Given microservices it's possible the edge code has been running longer than the TE. This could mean the Edge code is tracking a potential position. If the edge code stops sending entry signals when it's in a position this would mean the TE wouldn't ever enter that asset until the Edge code hits an Exit signal (TE would enter on the next Entry signal.) This may or may not be the behaviour we want for a given edge, depending on whether we want to enter trades mid-move if the TE misses the initial entry.
- Eventual Consistency
  - The TE won't know it's entered a trade till (24-8=16) hours after the signal is given if Entry signals are given on the Close and execution happens on the Open. 
- Exchange Implemented vs Dynamic Exits
  - Original Binance code let the exchange implement fixed and trailing stops. The depends on exchange capabilities - not all (spot) exchanges allow trailing stops or multiple stops. Requiring the Edge Exit code to track them. 
  - Both the Edge code and the Exchange would track stops that the exchange implements. i.e fixed stop defined on entry or perhaps trailing stops/
  - The Edge code needs to track these so it can do "backtesting" and/or track edge performance in the absense of the exchange entering a position.


# Solutions

## Heartbeats

Signals that are being tracked for exit conditions can send a heartbeat that the exit conditions logic is working for that signal. In the absence of the heartbeat the TE should exit the position.

## TE tells Edge code when it has entered a position

This would mean the Edge code should forward all Entry signals until the TE enters a position.

This would allow the Edge code to prune the tracked entry signals for that asset when it gets confirmation that the TE is in sync with one particular position.

## Tracking of Stops that the Exchange Implements in the Edge code

This is an instance of code duplication.

The Edge code needs to track stops that are defacto implemented by the Exchange. So the Edge code can do "backtesting" and/or track edge performance in the absense of the exchange entering a position.

This can also be used to calculate the impact of slippage on an Edge's execution.

## Using Stops based on Daily Candles

I'm not sure what this solves exactly except avoiding having to have a hot-wire with constant price data on it. But if you can update the stops just once a day things get simpler. A trailing stop updated just once a day (Say using ATR on the Dailies) is very easy to implement - or even to execute manually.

Heartbeats get easy, message bus usage is constrained, following the logs is easy, test cases get easy, ...

Ah yes that was the specific thing that gets easier - you can backtest (or just plan test) without needing tick data - you just need the Daily klines history which is easy to get. 
