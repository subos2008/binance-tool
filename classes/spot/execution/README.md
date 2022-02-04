These should be/become the exchange agnostic spot interfacing classes.

There are a few distinct ways we could want to interact with positons:
1. Open a new one - as in do the execution
2. Query the open positions, or a particular open position
3. Add a new position to the state 
  * currently positions are added by the position-tracker service when it sees filled orders

This directory is the execution - and should be used ony as a backend for a TAS

If you want to open positions as a 'user' you should use a TAS instead of these
classes directly
