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
