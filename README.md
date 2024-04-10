# Binance Tool

A cluster of microservices that watch exchange's websocket price streams and automatically trade based on 'edges'.

Over time this has grown into a bit of a behemoth and it's difficut to make profitable trading systems for crypto due to the large stop values needed. The included edge (services/edge70-signals) would have been profitable over prior bullmarkets but mainly because it had outsized returns on one or two symbols that it held rather than being profitable throughout. Portfolio gets eaten away at in during the chop between bull markets.

# Observability

JSON logging is used throughout and the system can be observed very well via Datadog. There are custom events and JSON logs that provide full coverage of all the interesting actions the trading engine performs.

# Services

  * Trend following edges that will watch price action and automatically enter and exit positions.
  * Positions services that watch the user's orders on the exchange and tracks open positions in redis.
  * Edge performance services that print to telegram stats when positions close
  * There is an event storage generic service that stores events in S3. 

See the commercial bot `cornix` also, that implements a lot of what we are targetting here.

Position sizing is currently fixed position size.

`Trading Engine` in ClickUp contains the backlog for this repo.

1. `position-sizer` - position sizing and risk are managed by a set of trading rules that define things like risk per trade and maxium open portfolio risk.
2. `edge-*` - these are the edges that watch the price action and give entry and exit signals
3. ...

## Setup

## Local Development and Testing

There is a `docker-compose` setup. You can experiment with `run-docker-tests.sh` and `run-docker-cluster.sh` to launch local Docker clusters to test the code.


### Infrastructure 

Kubernetes is expected - you can use any providers k8 setup. Once you have k8 setup investigate the infrastructure repo, flux/kustomize ready at https://github.com/subos2008/binance-tool/trading-engine-infrastructure/ (I haven't made this public yet, ping me if it interests you)

Slowly moving to terraform and github actions for the cluster setup. Production was set up from the
command line and the staging cluster setup is slowly being done via tf.

### Secrets

Adding secrets can be done with the scripts in `./k8/setup/` if you have a `.env` with the values in.

### Storage and Event Queues

You will need to add the `user` and `exchange` to AMQP (RabbitMQ) that is used by some of the services.

`redis` also needs to be available. There is a repo with the 

### Deployment

Deployment is into Kubernetes via a Helm chart and GitHub actions.

Deployment and config is done via a helm chart you can find in `./k8/charts/services/`. Note some values are hard coded like Sentry DSNs. Also check the helper file for the ENV setup constructs. Services are in `k8/charts/services/templates`

At the time of writing many services connect directly to Binance to pull in ws streams. Some of the more generic services listen to AMQP but it's a work in progress. Services are being renamed as `spot` versions in preparation for second versions that can trade long/shot on futures exchanges. Much of the current code makes spot specific assumptions.

There is no UI apart from telegram.

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
