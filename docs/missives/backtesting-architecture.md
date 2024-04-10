# Backtesting Architecture

## TL;DR

I want to have the edge I'm backtesting supplied in a form that can be plugged into production (live testing) or into a backtesting rig that functions in the same way as production. Often when developing an edge an engineer wants to write all their own backtesting code (to keep their Python Workbook neat). But things like position sizing and risk management code are a very important part of edge performance and you want them to be from a consistent and solid code base.

# Rambling - Commence!..

When writing code to test if an edge would be profitable we might start from scratch with a Python workbook. This has some disadvantages, discussed below.

I'm constantly drawn to a backtesting architecture that is fed Daily OHLC klines and outputs only entry/exit signals. 

This would be arguably inefficient as it ingests klines one by one instead of as a Dataframe.

Edge development is likely going to be slowed down - or will be done as normal in Python Workbooks before needing someone else to port the code into an edge that can be livetraded. 

Perhaps this is an intermediate stage where an Edge developer can work as they please but before allocating capital to an edge it needs to be ported. 

If edges are provided in a way that can accept klines and only output signals they can be plugged either into either the live-trading system or into a test rig that operates like production.


## Pros

1. We can't livetrade Dataframes code so it needs to be ported to something else at some point anyway
2. We can use Python to download candles data and analyse the results via DataFrames
3. Well defined edge interface that only allows daily klines and no tick data. Will force production of edges on a decent swing trading timeframe.
4. Can verify live trading code get's same results as backtest.

## Cons

1. Convincing another engineer this is a good idea seems unlikely.
1. If we use this for edge development from the start it will be slower and way more complex than a shared Python Workbook (can share Python Notebooks in VSCode and Git).

# Implementation

Having an API/Interface the Edge code plugs into that allows it to be tested and used as either a live Edge or backtester seems ideal.

We might want to use a harness that allows us to use Python for performance analysis.

So: `Daily OHLC Data` -> `Blackbox (Edge under test)` -> `Data File of Trades/Signals (Output)` -> `Python Performance Analysis`

# Generated Files

There are two types of data I've seen wanting to be generated / performance tweaked.

1. Raw Edge Signals - Only includes entry and exit signals (close prices and times). This is a nice intermediate format because you can experiment with different risk management and position sizing setups.
2. Trades Log - Actual trades that include position sizing and risk management descisions

# BackTesting using only Raw Signals Data

If we can backtest by just generating Raw Edge Signals data and that signals data can be loaded into highly evolved risk management aware harness this will give a better idea of real results than using whatever position sizing the edge developer chooses. i.e. having a 'company' set of risk management rules that we test edges under allows for a more sane backtest. If we someone is hacking up a rig to backtest an algo they quite often would use "invest the entire portfolio in each consecutive trade" or, even worse, invest a fixed amount into each trade and fail to check if the amount invested was more than the cash available.

This approach also prevents bugs in the backtesting rig code from changing the performance analysis.

Code that would be moved out of the Edge developer's responsibility and over to the rig include:

1. Position Sizing (i.e. not 100% of portfolio into every trade)
2. Risk Management (total portfolio at risk, etc)
3. Graphing portfolio size & amount invested

We made this split even in the Python code for edge71 testing. To separate all the risk management/position sizing code from the raw edge signalling code. It was a lot more readable to me but the Python newbie writing the Workbook wasn't so impressed.

If we developed a rig that you just pass an array of signals data into that would allow the company to develop high quality edge analysis code that lives separately from the edge code. It would also allow advanced risk-managememt analysis work to be done by a separate team and be it's own expert field.

It would also allow for *realistic* trade management to show us realistic expected returns.

It would also allow separating things like ***spot vs futures*** implementation differences *outside* of the edge code.

It would also mean we could do things like experienting with adding to positions separately without touching the Edge Signals code. i.e. do we add to a position when it gets an entry signal while already in the position.

This really does separate a *lot* of logic out of the edge specific code. The edge code becomes a tiny part of the whole. Which feels a lot better as the rig code can improve over time and isnt tied to a particular edge hack.

In the [Python Workbooks for testing Edge71](https://github.com/subos2008/trading-code/tree/main/edge71-python-workbooks) (Note this edge has distinct long and short versons - I'm not sure how well the code shows that).

