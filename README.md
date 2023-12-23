# Binance Tool

A cluster of k8 microservices that watch exchange's websocket streams and report to telegram.

# Services

  * Trend following edges that will watch price action and automatically enter and exit positions.
  * Positions services that watch the user's orders on the exchange and tracks open positions in redis.
  * Edge performance services that print to telegram stats when positions close
  * There is an event storage generic service that stores events in S3. 

See the commercial bot `cornix` also, that implements a lot of what we are targetting here.

Position sizing is currently fixed position size.

`Trading Engine` in ClickUp contains the backlog for this repo.

# Architecture

Been trying to keep it clean but it's still messy. 

It uses events and is moving towards event based logging so observability is pretty good. 

Data storage is in Redis, even things which really shouldn't be in redis. Most of the stuff stored in redis needs axing out and putting in a document or relational database.

As of tag `binance-spot-production-k8-stable` however it does work reliably. We shut down Binance trading at that tag and now I want to port it to serverless because the Kubernetes cost overhead was stupidly high for a few low-load microservices.

![Architecture](docs/diagrams/binance_spot_architecture.drawio.svg)

Source: https://app.diagrams.net/#G1yHn7t_QV53LrDXwxD5D7ez7qk3UdO8_a

Also see the OneNote "Trading Engine" workbook.

## Architectural Deep Dives

There are *a lot* of edge cases with real-time trading systems.

See the [Missives](docs/missives/) directory for deep dives into specific issues:

  - [Consecutive Trade Entry Signals](docs/missives/consecutive-trade-entry-signals.md) - what to do when you get an Entry signal that doesn't follow an Exit signal.

## Services

All in `/services/`. See the k8 chart for deployment.

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

Slowly moving to terraform and github actions for the cluster setup. Production was set up from the
command line and the staging cluster setup is slowly being done via tf.

Adding secrets can be done with the scripts in `./k8/setup/` if you have a `.env` with the values in.

You will need to add the `user` and `exchange` to AMQP that is used by some of these services.

`redis` also needs to be available. There is a repo with the infrastructure flux/kustomize ready https://github.com/subos2008/binance-tool/trading-engine-infrastructure/

Deployment and config is done via a helm chart you can find in `./k8/charts/services/`. Note some values are hard coded like Sentry DSNs. Also check the helper file for the ENV setup constructs. Services are in `k8/charts/services/templates`

At the time of writing many services connect directly to binnace to pull in ws streams. Some of the more generic services listen to AMQP but it's a work in progress. Services are being renamed as 'spot` version in preparation for second versions that can trade long/shot on futures exchanges. All the current code makes spot specific assumptions.

There is no UI apart from telegram.

# Connecting

In general there is no ingress. There is one for the telegram bot webhooks.

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
