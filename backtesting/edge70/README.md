what if we instantiate the positions tracker for tracking the positions in here?

Use mock redis.

We could convert edge events to Orders 

... we could use the position sizer

... track profit via edge performance events

But! We would still need to write daily portfolio value trackers
Convert stops into orders

## Interesting Metrics

1. Duration
1. total net loss / profit
1. total number of trades 
1. balance draw down 
1. number of winning trade 
1. number of lossing trade 
1. consecutive win 
1. consecutive loss

## Desired Metrics

1. Timeline of returns on positions based on when they were entered (not closed)
    * i.e. are positions entered earlier in the market big wins vs the mid / tail end of the bull run?

... perhaps we do a realised returns view. .. We can keep the edge performance events and at the end (or when the position is closed) we submit a metric timestamped at the start/end timestamp of the position? For wins only perhaps and the metric is the percentage change (ROI)

## Mode Desired Metrics

Below list from the [TradingView Portfolio Backtester Engine](https://www.tradingview.com/script/fhTLDun5-Portfolio-Backtester-Engine/). Let's also check what MetaTrader backtests provide.


      • Portfolio - Shows each security.
         • The strategy runs on each asset in your portfolio.
         • The initial capital is equally distributed across each security.
          So if you have 5 securities and a starting capital of 100,000$ then each security will run the strategy starting with 20,000$
          The total row will aggregate the results on a bar by bar basis showing the total results of your initial capital.
      • Net Profit (NP) - Shows profitability.
      • Number of Trades (#T) - Shows # of trades taken during backtesting period.
         • Typically will want to see this number greater than 100 on the "Total" row.
      • Average Trade Length ( ATL ) - Shows average # of days in a trade.
      • Maximum Drawdown (MD) - Max peak-to-valley equity drawdown during backtesting period.
         • This number defines the minimum amount of capital required to trade the system.
         • Typically, this shouldn’t be lower than 34% and we will want to allow for at least 50% beyond this number.
      • Maximum Loss (ML) - Shows largest loss experienced on a per-trade basis.
         • Normally, don’t want to exceed more than 1-2 % of equity.
      • Maximum Drawdown Duration ( MDD ) - The longest duration of a drawdown in equity prior to a new equity peak.
         • This number is important to help us psychologically understand how long we can expect to wait for a new peak in account equity.
      • Maximum Consecutive Losses ( MCL ) - The max consecutive losses endured throughout the backtesting period.
         • Another important metric for trader psychology, this will help you understand how many losses you should be prepared to handle.
      • Profit to Maximum Drawdown (P:MD) - A ratio for the average profit to the maximum drawdown.
         • The higher the ratio is, the better. Large profits and small losses contribute to a good PMD .
         • This metric allows us to examine the profit with respect to risk.
      • Profit Loss Ratio (P:L) - Average profit over the average loss.
         • Typically this number should be higher in trend following systems.
         • Mean reversion systems show lower values, but compensate with a better win %.
      • Percent Winners (% W)- The percentage of winning trades.
         • Trend systems will usually have lower win percentages, since statistically the market is only trending roughly 30% of the time.
         • Mean reversion systems typically should have a high % W.
      • Time Percentage (Time %) - The amount of time that the system has an open position.
         • The more time you are in the market, the more you are exposed to market risk, not to mention you could be using that money for something else right?
      • Return on Investment (ROI) - Your Net Profit over your initial investment, represented as a percentage.
         • You want this number to be positive and high.
      • Open Profit (OP) - If the strategy has any open positions, the floating value will be represented here.
      • Trading Days ( TD ) - An important metric showing how many days the strategy was active.
         • This is good to know and will be valuable in understanding how long you will need to run this strategy in order to achieve results.
