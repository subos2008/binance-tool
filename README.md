# Binance Tool

## Project Status

*I'm not sure I would use this code to actually trade any more but it might be an interesting study for someone looking to deep dive into the kind of edge cases real-time trading systems need to deal with.*

I opened up the code largely to build up my portfolio of what I share publically.

`Trading Engine` in ClickUp contains the backlog for this repo. (private)

## Intro

A cluster of microservices that watch exchange's websocket price streams and automatically trade based on 'edges'.

Over time this has grown into a bit of a behemoth and it's difficut to make profitable trading systems for crypto due to the large stop values needed. The included edge (services/edge70-signals) would have been profitable over prior bullmarkets but mainly because it had outsized returns on one or two symbols that it held rather than being profitable throughout. Portfolio gets eaten away at in during the chop between bull markets.

## User Interface

## Telegram Bot

Bert, our resident telegram bot, has a few commands. You can add the telegram bot to a group if you want to grant access to others or message it directly. For security the command set is a simple enter/exit/list symbols. Position sizing is done by the backend and can't be overridden manually.

## Grafana Dashboards

Portfolio value and data on individual holdings is set to InfluxDB. This allows you to connect Grafana or another dashboard frontend and see how your portfolio is performing. There is an example dashboard used for backtesting in [./grafana]

## CLI

There is also `./cli/*` and `proxy-redis.sh`.

# Observability

JSON logging is used throughout and the system can be observed very well via Datadog. There are custom events and JSON logs that provide full coverage of all the interesting actions the trading engine performs.

Logs of all events are persisted in `s3` and `MongoDB`. Almost everything of interest that the system does is logged as an event.

# Architecture

Been trying to keep it clean but it's still messy. In particular the code around trade execution has more layers than it needs to in an attempt to make something that can interface with multiple exchanges.

We try and use the exchange as the source of truth where possible and there are services that will check and report on inconsistencies between the open trades we expect and the holdings on the exchange.

AMQP is used between services where things are async to improve fault tolerance. There's a REST interface for position entry/exit that is used by the edge signals code. Position sizing and risk management is done inside the trading engine and can't be interfered with by the end user.

The design is event-driven and all events are logged so observability is pretty good. 

Data storage is in Redis, even things which really shouldn't be in redis. Most of the stuff stored in redis needs axing out and putting in a document or relational database.

As of tag `binance-spot-production-k8-stable` however it does work reliably. We shut down Binance trading at that tag and now I want to port it to serverless because the Kubernetes cost overhead was stupidly high for a few low-load microservices.

![Architecture](docs/diagrams/binance_spot_architecture.drawio.svg)

Source: https://app.diagrams.net/#G1yHn7t_QV53LrDXwxD5D7ez7qk3UdO8_a

Also see the OneNote "Trading Engine" workbook.

## Architectural Deep Dives

There are *a lot* of interesting edge cases with real-time trading systems.

See the [Missives](docs/missives/) directory for deep dives into specific issues:

  - [Consecutive Trade Entry Signals](docs/missives/consecutive-trade-entry-signals.md) - what to do when you get an Entry signal that doesn't follow an Exit signal.

## Services

All in `/services/`. See the k8 chart for deployment.

1. `binance-orders-to-amqp` - we run a couple of these and they spead accross instances for relaibility. These connect to the exchange and watch the activity on your account. They forward everything they see to an AMQP message bus for processing. Message deduplication is done by AMQP.
1. `position-sizer` - position sizing and risk are managed by a set of trading rules that define things like risk per trade and maxium open portfolio risk.
2. `edge-*` - these are the edges that watch the price action and give entry and exit signals
  1. `edge-signal-to-tas-bridge` - a clunky design decision - maps edge specific things like which order tyes (LIMIT or MARKET) are used to enter trades and how much slippage is allowed, etc.
3. `bert` - your friendly telegram bot, keeps you updated on everything the system is doing and allows you to enter and exit trades manually.
1. `event-logger` - we queue messages to be delivered to the user via AMQP. This means if we hit the telegram rate limit - which we can on crypto markets as there's a lot of price correlation - we don't loose any messages.
1. `portfolio-to-influxdb` - updates InfluxDB timeseries database every time the portfolio changes. Also logs USD equiv values every few hours.
1. `order-tracker`, `portfolio-tracker` and `position-tracker` - take order data off AMQP and updates the portfolio state. c.f. `binance-orders-to-amqp`
1. `position-performance` - gives regular updates on the performance of open positions.
1. `spot-trade-abstraction` - the Trade Abstraction Service (TAS)



### Ingestion

`execution-reports-to-amqp` and `binance-orders-to-amqp` these listen to the exchange on web sockets and get that info into queues asap. Simple, redundant, services with the singular goal of not missing anything important from the exchange WebSockets even if a rolling update is happening.

### Edge Signals

#### edge70-signals

Listens to the candle data streamed from the exchange and generates buy/sell signals. (long/short/close)

### TAS - Trade Abstraction Service

The worst part of the code. Deals with interacting with the actual exchange. Needs moving to something declarative, see designs in OneNote for proposed new architecture.

#### trade-abstraction-v2

An HTTP endpoint that wraps Binance Spot. The idea is it abstracts everything, you send it `/long` or `/close` or `/short` and it does the rest. However this means it has code to map edge names to executors for those edges as well as code to wrap Binance at the low level (429 retires, etc) and everything in between. While trying to be generic enough that other exchanges could be dropped in and supported. Allowing us theoretically to trade Edge70 on Binance, FTX, etc - and stocks and commodities - all using a similar API. Obviously it turned into a horrible mess.

### User Alerts

Popped on a queue that's delivered to Telegram. See `services/amqp/send-message`


## Setup

## Local Development and Testing

There is a `docker-compose` setup. You can experiment with `run-docker-tests.sh` and `run-docker-cluster.sh` to launch local Docker clusters to test the code.

Setting up a local `.env` using [./dot-env-template] is a good first configuration step.

### Infrastructure 

A Kubernetes cluster is expected to be setup in advance. You can use any provider. Once you have k8 setup investigate the infrastructure repo, flux/kustomize ready at https://github.com/subos2008/binance-tool/trading-engine-infrastructure/ (I haven't made this public yet, ping me if it interests you)

### Secrets

Adding secrets to the k8 cluster can be done with the scripts in `./k8/setup/` if you have a `.env` with the values in. Use [./dot-env-template](./dot-env-template).

### Storage and Event Queues

You will need to add the `user` and `exchange` to AMQP (RabbitMQ) that is used by some of the services.

`redis` also needs to be available. There is a repo with the 

### Deployment

Deployment is into Kubernetes via a Helm chart and GitHub actions.

Deployment and config is done via a helm chart you can find in `./k8/charts/services/`. Note some values are hard coded like Sentry DSNs. Also check the helper file for the ENV setup constructs. Services are in `k8/charts/services/templates`

At the time of writing many services connect directly to Binance to pull in ws streams. Some of the more generic services listen to AMQP but it's a work in progress. Services are being renamed as `spot` versions in preparation for second versions that can trade long/shot on futures exchanges. Much of the current code makes spot specific assumptions.

# Connecting

In general there is no ingress. There is one for the telegram bot webhooks. There are a few commands for entering and exiting positions and listing open positions available via the telegram bot.

kubectl port-forward --namespace persistent-state svc/bitnami-redis-master 6379:6379

![](https://github.com/subos2008/binance-tool/workflows/DockerPublish/badge.svg)

# Messaging

See `classes/amqp/message-routing.ts` for events.

Mainly using RabbitMQ and amid switching from classic to quorum. We almost certainly want to move to
streams instead. Critical services don't scale horizontally yet as there is no message de-duplication.
It particular there is no out-of-order message support, handling of more-than-once delivery, or atomic operations in the `positions` code. This coule be addresses but probably moving to declarative `trades` instead of positions
makes more sense - if the `positions` code survives the upgrade it needs to be atomic at some point.

_ISSUE:_ Just moved BinanceOrderData queues to `quorum` type, quorum queues move messages being redelivered to the end of the
queue and the services are not set up for out-of-order delivery.

# Ingress and Certs

https://www.digitalocean.com/community/tutorials/how-to-set-up-an-nginx-ingress-on-digitalocean-kubernetes-using-helm
