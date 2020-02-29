# Update

This tool is currently migrating from being a command line process that
takes parameters and runs until the trade completes into a tool that
adds a trade_definition to redis and associated tools that take a trade_id
and retrieve and execute that trade. This can thus be used for executing
trades using a remote cluster.

# TODO

- exit on unhandled promise errors
- create a cli tool to list trades
- remove AsyncErrorWrapper
- log with timestamps
- log in json
- log to a log collector
- know when it has already bought or created buy/sell orders:
  - trades:\$id:position
  - trades:\$id:open_orders
- make restartable and remove backoffLimit
- integrate with https://sentry.io
- not all awaits are wrapped in try/catch: fix bug - doesn't exit:

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

class FillOrDrainPosition

- has a stop level on fill because we ... no when buying there is no stop.. states? : states: filling, draining at target, draining at stop
- this.ee.ws.user moves into this class
- position sizing can then move into this class
- what about states prepped for target/stop draining
- draining cancelled is a state perhaps

I think what we need to do is have current_position in redis and a state or filling or draining. draining would probably have to distinguish target or stop. test cases for hitting stop while filling.

Could introduce a trade monitior stop that sets the state based on the pice action. It sets the state. The state is executed by the FillOrDrainPosition class. Flip: the draining is signalled a bit before so the orders are in the books earlier.

A TradeDefinition class could lift some printfs with a toString. Maybe print_percentages_for_user could also move into that.

\_munge_amount_and_check_notionals can move to the AlgoUtils class

### Kubernetes Workflow

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
