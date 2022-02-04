These should be/become the exchange agnostic spot interfacing classes.

There are a few distinct ways we could want to interact with positons:
1. Open a new one - as in do the execution
2. Query the open positions, or a particular open position
3. Add a new position to the state 
  * currently positions are added by the position-tracker service when it sees filled orders

In this directory are the fluffy, largely read only, query abstractions.

Anything to do with anything more low level should be routed through the TAS so trade_rules and
position_sizing are respected
