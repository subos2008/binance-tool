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
