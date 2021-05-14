A cluster of k8 microservices plus the original binance-tool OCO trader.

The OCO trader is a bit clunky and is being ported in this repo to a bunch
of services that automatically create positions based on the Binance order feeds

Automatic exits are currently being added to new positions, like 10% sell at 10% gain



![](https://github.com/subos2008/binance-tool/workflows/DockerPublish/badge.svg)

# Fails when only stopOrderId set

```
2020-05-11T22:16:24.51687425Z Set telegram prefix to "binance-tool: "
2020-05-11T22:16:30.192177911Z Warning trading rules hardcoded twice
2020-05-11T22:16:30.909323577Z From redis:
2020-05-11T22:16:30.910605378Z {
2020-05-11T22:16:30.910612872Z   pair: 'AIONBTC',
2020-05-11T22:16:30.910617031Z   base_amount_imported: '0',
2020-05-11T22:16:30.910620852Z   soft_entry: 'true',
2020-05-11T22:16:30.910624461Z   auto_size: 'true',
2020-05-11T22:16:30.910638133Z   buy_price: '0.0000089',
2020-05-11T22:16:30.910641408Z   stop_price: '0.00000858',
2020-05-11T22:16:30.910644649Z   target_price: '0.00000927'
2020-05-11T22:16:30.910647891Z }
2020-05-11T22:16:30.910651057Z Oooh, trade_definition with base_amount_imported (0)
2020-05-11T22:16:30.910654338Z TradeDefinition created with no exchange_info specified
2020-05-11T22:16:30.992291673Z {
2020-05-11T22:16:30.992336057Z   base_amount_held: '...',
2020-05-11T22:16:30.992340458Z   trade_completed: false,
2020-05-11T22:16:30.992343666Z   targetOrderId: undefined,
2020-05-11T22:16:30.992346724Z   stopOrderId: '...',
2020-05-11T22:16:30.992349829Z   buyOrderId: undefined,
2020-05-11T22:16:30.992352876Z   trade_id: '46'
2020-05-11T22:16:30.992356144Z }
2020-05-11T22:16:31.007900292Z trade_completed=false
2020-05-11T22:16:31.008063058Z Live trading mode
2020-05-11T22:16:31.022795098Z PriceRanges should refresh with exchange_info
2020-05-11T22:16:31.092631656Z Mon May 11 22:16:31 UTC 2020
2020-05-11T22:16:32.255672601Z WARNING: STOP_LOSS_LIMIT orders need work
2020-05-11T22:16:32.266214636Z Stop percentage: 3.60%
2020-05-11T22:16:32.266824276Z Target percentage: 4.16%
2020-05-11T22:16:32.267200081Z Risk/reward ratio: 1.2
2020-05-11T22:16:32.269119029Z AIONBTC: from buy: 0.0000089 to stop: 0.00000858 or target: 0.00000927
2020-05-11T22:16:34.676357479Z placeSellOrder: orders already exist, skipping. (stop: 69200853, target: undefined)
2020-05-11T22:16:34.696631726Z Soft entry buy order trigger price: 0.0000089445
2020-05-11T22:16:34.700184426Z Soft entry mode: waiting for entry price before placing order
2020-05-11T22:16:46.314950969Z AIONBTC soft entry buy order trigger price hit
2020-05-11T22:16:46.719968566Z Not allowed to buy, skipping request to placeBuyOrder
```

# BNB trade problem

Currently the total amount bought reported is more than the actual amount bought. It appears
to be that the transaction cost is deducted from the amount bought in BNB is not available.
This causes placing stop orders to fail if the BNB balance is zero

# race condition

Base amount changed during munging from 107.6235955 to 107.
set_redis_key trades:43:position:target_base_amount_to_buy to 107
base_amount: 107
AIONBTC Creating LIMIT BUY ORDER for 107 at 0.0000089
AIONBTC BUY LIMIT ORDER #69199135 (NEW)
..price: 0.00000890, quantity: 107.00000000
AIONBTC BUY LIMIT ORDER #69199135 (PARTIALLY_FILLED)
..price: 0.00000890, quantity: 107.00000000
order id: 69199135
set_redis_key order_associations:69199135:trade_id to 43
AIONBTC BUY LIMIT ORDER #69199135 (FILLED)
..price: 0.00000890, quantity: 107.00000000
set_redis_key trades:43:open_orders:buyOrderId to 69199135
Didn't recognise order: 69199135 [buy: 69199135 stop: undefined target: undefined]

Could fill the order before we are finished setting it in redis. Would set to undefined maybe before 
then setting again to the buy order id

# Usage

Beware the default behaviour is to launch a job in k8 to execute the trade. i.e. there will not be a local process or output to the terminal.

```
./create-trade <args>
```

You can also run locally with command: ["node", "service.js", "--trade-id", "{{trade_id}}", "--live"]

# Update

This tool is currently migrating from being a command line process that
takes parameters and runs until the trade completes into a tool that
adds a trade_definition to redis and associated tools that take a trade_id
and retrieve and execute that trade. This can thus be used for executing
trades using a remote cluster.

The next major step for this codebase is to split it up into services that
can be updated from CI. At the moment each run manages a complete individual
trade and we pray the processes never restart. This needs to be moved to a
model where state is in Redis and the services are all restartable.

First target is getting orderId's in redis.

---

## Consistency Checker service

*Not built yet: TODO*

1. Given a trade with a buy order if the buy order is complete then the buyOrderId in the trade and the amount bought have been updated (this is a real case where we crash out or somehow miss the updating of the trade when the order complete notification goes out)
1. Open orders are for the correct amount at the correct prices (imagine we tweak a trade definition when the relevant order is already placed)

### Seen when we had three trade executor pods running for a trade:

1. Orders that are in the OrderTracker namespace as PARTIALLY_FILLED that according to
   the exchange have filled. Just seen this happen. WOA: eventually it resolved, binance
   was just being slow sending out the message! Like 5-15m slow afaict
1. Reality is trade has a stopOrderID on the exchange and the buy order is complete, but
   redis thinks it's still waiting for the buyOrder to complete... I just saw some very strange shit where the buy order was gone on the exchange and the stop order had been
   placed but the redis state wasn't reflecting that (the buy order was still waiting to be filled according to the redis state)

---

# TODO

- rename `base_amount_held` to `base_amount_imported` and add amount bought tracking separately.
- if we split the price movement into it's own process and have services send an event to the main trade process when there's something it needs to know - then we can do away with the behaviour of checking `trades*:*OrderId` every price tick.
- if `*:*orderId`s are already set we would need to cancel our order. disasterous though (concurrency issue) would be better to have some way of preventing concurrent placing of orders - such as setting something before creating the order.
- typescript
- re-entrant when sell orders are present
- promise return from send_message so I can quit after messages are delivered
- move `monitor_user_stream` out of process somehow. Maybe it sends to RabbitMQ with orders routed to sepecific trades. But most of my worst code complexities are around missing order updates so if that code can be solid it's a winner. Could be watch binance user stream -> rabbitMQ generic -> route per trade -> persistant queues and the updating of redis -> ping the trades themselves. The ping to the trades themselves could be kind of a generic re-calculate everything from redis style thing; trade would check sell orders covered the held amounts etc. Could also break out the price monitor to forward to RabbitMQ on interesting price levels too. So the trade process just knows what state it's in (close_to_stop, etc) and how much position size it's managing.
- need to redis.quit() in shutdown_streams
- if we pass `base_amount_held` it's not using that in the calc of how much to buy and it's buying the same amount again (and overwriting it in redis)
- move to `base_amount_imported` and `base_amount_bought` ? with base_amount_held being a sum of the two.
- we detect cancelled orders and shutDown but we don't clean up redis
- add sentry.io
- list-trades.js to know if there is a position on a trade trades:\$id:position
- trade_definition that checks validity and makes everything BigNumber
- remove AsyncErrorWrapper
- log with timestamps
- log in json
- log to a log collector
- know when it has already bought or created buy/sell orders:
- make restartable and remove backoffLimit
- integrate with https://sentry.io
- base_amount_held -> setup position. so tests convert -a to checking pre-existing postion
- not all awaits are wrapped in try/catch: fix bug - doesn't exit:
- remove async_error_handler (sentry)
- update base_amount_held even if order is not 100% complete (i.e. stops out during fill/target_drain and better if restarting?)
- elements:
  1. managing the exiting orders and changing state (placing stop orders) when trades complete
  1. the initial buy order: create immediately or monitor price for soft_entry
  1. swapping between stop and target orders as the price tracks about. If this could be somewhat independent of the checks for orders completing we could handle partial orders much better. Maybe even rabbitMQ has events for helping.
- dealing with restarting while a buy order is partially executed. we need to add on any base_amount_held from the start of the trade and sum that with the amount bought
- limit `max_portfolio_allowed_in_trade`:
  ```
  Max portfolio loss per trade: 1%
  Stop percentage: 0.09%
  Target percentage: 0.26%
  Risk/reward ratio: 3.0
  Max portfolio allowed in trade: 1173.0%
  ```

```
Available to invest: 0.01178127 USDT
Sized trade at 0.01178127 USDT, 0.00064577 BNB
(node:1) UnhandledPromiseRejectionWarning: Error: 0 does not meet minimum quantity (LOT_SIZE): 0.01000000.
    at Object.munge_and_check_quantity (/app/lib/utils.js:100:9)
    at AlgoUtils.munge_amount_and_check_notionals (/app/service_lib/algo_utils.js:36:24)
    at TradeExecutor._munge_amount_and_check_notionals (/app/lib/trade_executor.js:364:26)
    at TradeExecutor._create_limit_buy_order (/app/lib/trade_executor.js:209:23)
    at processTicksAndRejections (internal/process/task_queues.js:93:5)
    at async /app/lib/trade_executor.js:503:25
(node:1) UnhandledPromiseRejectionWarning: Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). (rejection id: 1)
(node:1) [DEP0018] DeprecationWarning: Unhandled promise rejections are deprecated. In the future, promise rejections that are not handled will terminate the Node.js process with a non-zero exit code.
```

- aha - I could break out the service that watches for executed trades. load from redis the order
numbers and update the position held data.this is nice because its oer trade data being managed by a shared process.
- if a buyOrder gets cancelled do we want to add something to the trade state? `buyCancelled`, `buyingComplete`, `buyingAllowed = false`? 
- `base_amount_held` becomes derived, computed from `base_amount_imported`, `base_amount_bought` and `base_amount_sold`. A trade is completed when it has no open orders and `base_amount_held` is too small to be tradeable.
- How do we calculate `base_amount_sold`? We want it to update on partial fills of target and stop orders. Assuming we can bounce around from stops to targets we want to incrementally eat down the position on each partial fill. 
- I think a `trade-position-tracker` service is in order. This maintains the components of `base_amount_held` and signals when the position size of a trade has changed. Initial implementation can simply signal when an order is complete so we avoid complexity around the exchange's order api rate limiting.
- exchange_info should be reloaded periodically and we should recalculate munged values
- Create an interface for ee's
- Wrap all the class main()s in sentry exception handlers
- Let's use faux internal events to evolve the TradeOrderSetter but eventually we want to trade state in redis and just to be sending
     'state changed' events to cause it to look up the current trade state and check for adjustments that need to be made. If we rely
     on events to hold the trade state they can get out of date. However, *first we need to determine what the trade states are.*
- we hammer redis loading multiple orderIds on every trade event from the exchange
- *Test*: we import almost enough to fill what we are allowed to trade but the amount extra we would buy is below the notional checks, so we wouldn't buy more

## states

1. waiting for approx buy price - waiting_for_entry_price
1. close to entry, add buyOrder - buy_order: now this can be 0% filled, partialled filled, 100% filled it's really: buy_filling/filled
1. filling with stop awareness (and target too). stops and target are always soft. this translates into a kind of ittt trade defn language. If we had that we could check for overlapping stop/target trigger prices.
1. filled, with stop trade in books (or we always update the stop trade as the buy fills)
1. close to target, with target sell in the books
1. completed.

- i think actually we have:
  1. waiting for entry
  1. amorphous blob of trade_active (beware that a partial target exit doesn't result in more buying - maybe that's the 70%-to-target rule: it invalidates \[more\] buying)
  1. completed states. even then it's just invalidated before entry or completed. stop/target sells can be partial and we can have both in a trade result. `sold_at_stop_percentage/amount` and `sold_at_target_percentage/amount`
- what about `maintaining-sell-orders` and `maintaining-buy-and-sell-orders` there's a slight difference when the buying has completed..? I guess `buying-allowed` is a parallel state; would clean up any buy orders when entered. States might be `close-to-stop` and `close-to-target` or maybe `prepared-for-stop` and `prepared-for-target`. Of course **it's not one state, it's parallel states, two, three?**
- So:
  - [`buying-allowed`]
  - [`prepared-for-stop` | `prepared-for-target` | `no-position`]
  - [`buying-in-progress` | `buying-complete`] <--- absorbs into `buying_allowed`?
  - [`trade-complete`]
- services:
  1. user stream watcher - updates redis state on order execution, pings trade process when state has changed or orders completed/cancelled
  2. trade process - maintains orders
  3. price watcher - pings the main trade process when price levels are crossed

## position states

1. filling
1. filled as much as possible
1. filled as much as possible, which was zero
1. draining at target
1. draining at stop (note can drain at target for a while then remainder at stop)


## testing

Tests should look like:

- test_definition test_state in redis prior to test
- EE setup with price events and placing orders in the order books to allow for full/partial fills
- test pass/fail could just check the output of redis.MONITOR for SET events in the expected order
- buy_price is set (would normally indicate to buy) but `base_amount_held` is non-zero.
  - case 1: buyOrderID is set
  - case 2: buyOrderID is null - should go straight into placeSellOrder()

## Trade Flow

1. Maybe wait for entry price
1. Create buy order
1. Wait for buy order to fill or trade to invalidate by hitting target before buy_price. set buy disabled if we hit target. complete order if position is zero. sets `buy_disabled` if buy sell completes.
1. Once we are in a position then maintain target and stop orders. Also: possibly the buy order is still open. Track total bought as position size might flow up and down. Set buy_disabled if we hit target.
1. once the trade has emptied it's position then set completed and exit.

## class FillOrDrainPosition

- has a stop level on fill because we ... no when buying there is no stop.. states? : states: filling, draining at target, draining at stop
- this.ee.ws.user moves into this class
- position sizing can then move into this class
- what about states prepped for target/stop draining
- draining cancelled is a state perhaps

I think what we need to do is have current_position in redis and a state or filling or draining. draining would probably have to distinguish target or stop. test cases for hitting stop while filling.

Could introduce a trade monitior stop that sets the state based on the pice action. It sets the state. The state is executed by the FillOrDrainPosition class. Flip: the draining is signalled a bit before so the orders are in the books earlier.

A TradeDefinition class could lift some printfs with a toString. Maybe print_percentages_for_user could also move into that.

Test migration could look like migration towards setting trade states in the tests. First in addition to setting orders and then splitting to cheking seting states in the monitor and then reacting to states in the FillOrDrainPosition reaction.

\_munge_amount_and_check_notionals can move to the AlgoUtils class

### Kubernetes Workflow

_There's a github workflow also_

create a `.env` file:

```bash
APIKEY=
APISECRET=
TELEGRAM_KEY=
TELEGRAM_CHAT_ID=
# warning DOCKER_REGISTRY is hardcoded in run-in-k8.sh
DOCKER_REGISTRY=
DOCKER_REGISTRY_PASSWORD=
DOCKER_REGISTRY_USER=
KUBECTL_CONTEXT=
KUBECTL_NAMESPACE=binance-tool
```

Run `./publish.sh` to buid and push the image to the docker registry.

`create-trade.js` has the same cli as the old `binance-tool` but also add `--launch`. It will create a trade in redis then launch a Job to run the trade.

**Note**: the Job launched into k8 currently doesn't have `--live` in the template so will just exit pretty much immediately.

---

# Binance Trading Tool

A command line tool for managing trades on [Binance](https://www.binance.com/?ref=12598108).

The tool is designed to allow enforcement of trading rules, such as maximum portfolio risk per trade, and facilitate having multiple potential trades open at the same time. With the use of `--soft-entry` multiple potential trades can be open simultaneously and capital is only committed in the order book when the entry price on the trade looks likely to hit.

Note: as with all MIT licenced code this is provided without warranty or expectation of fitness for purpose, see the `LICENSE` file. You use this at your own risk.

## Features

Note: many of these features have caveats, you are responsible for reading the code and understanding the details of how it works. You are responsible for your own actions at all times.

1. Ability to specify buy, stop and target prices. Once the buy order is filled then the stop/target orders will automatically get entered in the order book.
1. "Soft entry" (`--soft-entry`) on limit buys. The buy order is only placed in the order book when the limit buy price approaches. This allows you to have multiple open trades and only commit funds to them when the entry price gets close.
1. OCO (Order-Cancels-Order) orders: having both a stop and a target exit price for your trade. The tool will remain open and monitor the price the pair is trading at. The stop order will sit in the books until either it gets filled or the price hits the target price. When the target price is hit the stop order is cancelled and a limit sell at the target price replaces it in the books. Note the code may not yet handle partial fills.
1. Notifications via Telegram when limit prices are hit/filled.
1. Support for `--auto-size` and trading rules. Risk management is a key component of good trading. The tool contains a `PositionSizer` that will size trades according to the total size of your portfolio and your defined maximum risk per trade. The percentage loss that would incurred on the trade (if the stop loss is hit) is used to limit the percentage of your portfolio that can be allocated to a given trade.
1. Specifying buy order sizes in the [quote currency](https://news.tradimo.com/glossary/quote-currency/). Binance only accepts [base](https://news.tradimo.com/glossary/base-currency/) amounts - i.e. if you want to buy the BNBUSDT pair you need to specify the amount of BNB to buy. This is equivalent to using `-a` with this tool. However, specifying the order size in the quote currency is also supported: `node binance -p BNBUSDT -q 100 -b 34` would calculate an order to buy 100 USDT worth of BNB at a price of 34. Market buys are also supported (though have received less testing) by passing just `-b` without a price.

## Installation

Prerequisites: You will need `git` and `node.js` installed.

Check out the code from github locally, cd into the folder and run `node binance` to see the arguments the program accepts.

e.g:

```
$ node binance
Usage: binance

Options:
  --help                  Show help                                    [boolean]
  --version               Show version number                          [boolean]
  -p, --pair              Set trading pair eg. BNBBTC                 [required]
  -a, --base_amount       Set base_amount to buy/sell                   [string]
  -q, --amountquote       Set max to buy in quote coin (alternative to -a)
                                                                        [string]
  -b, --buy, -e, --entry  Set buy price (omit price for market buy)     [string]
  -s, --stop              Set stop-limit order stop price               [string]
  -l, --limit             Set sell stop-limit order limit price (if different
                          from stop price)                              [string]
  -t, --target            Set target limit order sell price             [string]
  --soft-entry            Wait until the buy price is hit before creating the
                          limit buy order             [boolean] [default: false]
  --auto-size             Automatically size the trade based on stopLoss % and
                          available funds             [boolean] [default: false]
  --percentages           Print trade stats and exit  [boolean] [default: false]
  -F, --non-bnb-fees      Calculate stop/target sell amounts assuming not paying
                          fees using BNB              [boolean] [default: false]

Examples:
  binance -p BNBBTC -a 1 -b 0.002 -s 0.001  Place a buy order for 1 BNB @ 0.002
  -t 0.003                                  BTC. Once filled, place a stop-limit
                                            sell @ 0.001 BTC. If a price of
                                            0.003 BTC is reached, cancel
                                            stop-limit order and place a limit
                                            sell @ 0.003 BTC.

Missing required argument: pair
```

## Configuration

Create a file called `.env` in the checked out folder.

Add your [Binance API key](https://support.binance.com/hc/en-us/articles/360002502072-How-to-create-API) in the following format. Replace `BINANCE_API_KEY` with your API key and `BINANCE_API_SECRET` with your API secret.

<pre>
APIKEY=<b>BINANCE_API_KEY</b>
APISECRET=<b>BINANCE_API_SECRET</b>
</pre>

If you want alerts via Telegram you must also add your `TELEGRAM_KEY` and `TELEGRAM_CHAT_ID` in the same style. Starting instructions for this can be found [here](https://stackoverflow.com/questions/32423837/telegram-bot-how-to-get-a-group-chat-id). Pull requests welcome to improve these instructions.

Using this tool without Telegram set up has not been tested.

## Functionality

This is alpha / beta quality code and the most up to date documentation for what works and what doesn't is the output of the tests:

Run `yarn test` to see the current functionality.

```
$ yarn test

... lots of test output ...

95 passing (196ms)
129 pending
```

As you can see there are a large number of untested cases that we are aware of. An example would be passing a buy and stop price above the current price. The code doesn't currently check that the current price is above the stop price before executing the orders. The buy would complete and then the stop, which is implemented with a `STOP_LIMIT_SELL` order type would be refused by the exchange as it would execute immediately.

## Usage

The most common usage: specifying a full trading plan with buy, stop and target prices. As `--auto-size` is specified the trading rules are used to size the trade accordingly. The use of `--sort-entry` keeps the trade out of the order book until the buy price approaches. This allows multiple potential trades to be open and only commits capital to a trade setup when its entry price gets close.

Here you can see that the trading rules specify a maximum portfolio risk per trade of 1%. Given the trade has a loss of 3.23% if the stop loss gets hit, then a maximum of 31% of portfolio can be used for this trade.

```
$ node binance -p BNBUSDT --auto-size --soft-entry -b 31 -s 30 -t 40

Soft entry buy order trigger price 31.155
Tue 18 Jun 2019 08:03:22 UTC
Max portfolio loss per trade: 1%
Stop percentage: 3.23%
Target percentage: 29.03%
Risk/reward ratio: 9.0
Max portfolio allowed in trade: 31.0%
BNBUSDT New trade: buy: 31 stop: 30 target: 40
Soft entry mode: waiting for entry price before placing order
```

Updates will be sent to Telegram as the trade progresses:

```
binance-tool: BNBUSDT New trade: buy: 31 stop: 30 target: 40
```

```
binance-tool: BNBUSDT soft entry buy order trigger price hit
binance-tool: BNBUSDT buy order filled
```

```
binance-tool: BNBUSDT target price hit
binance-tool: Event: price >= target_price: cancelling stop and placeTargetOrder()
binance-tool: BNBUSDT target sell order filled
```

# Credits

This tool was inspired by `binance-oco` by Tony Ho and available [here](https://www.npmjs.com/package/binance-oco)
