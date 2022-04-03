# Binance Tool

A cluster of k8 microservices that watch exchange's websocket streams and report to telegram.

Contains an Edge56 (momentum trading) service that watches for entries and alerts the user by message.

Also contains services that watch the users orders on the exchange and tracks open positions in redis.

See the commercial bot `cornix` also, that implements a lot of what we are targetting here.

This repo was originally the old OCO trader that implemented OCO trades on Binance before they were natively available. That original script had lots of functionality - like position sizing based on portfolio size and stop percentage - that is yet to be ported to the services based code here.

Over time this repo could do things like automatically enter trades based on entry signals with automatic position sizing and trade management. 

`Trading Engine` in Asana contains the backlog for this repo.

Services that listed to the Binance user websockets publish to RabbitMQ. There is an event storage generic service that stores events in S3. See `classes/amqp/message-routing.ts` for events.

## Setup

Adding secrets can be done with the scripts in `./k8/setup/` if you have a `.env` with the values in.

You will need to add the `user` and `exchange` to AMQP that is used by some of these services.

`redis` also needs to be available. There is a repo with the infrastructure flux/kustomize ready https://github.com/subos2008/binance-tool/trading-engine-infrastructure/

Deployment and config is done via a helm chart you can find in `./k8/charts/services/`. Note some values are hard coded like Sentry DSNs. Also check the helper file for the ENV setup constructs. Services are in `k8/charts/services/templates`

At the time of writing many services connect directly to binnace to pull in ws streams. Some of the more generic services listen to AMQP but it's a work in progress. Services are being renamed as 'spot` version in preparation for second versions that can trade long/shot on futures exchanges. All the current code makes spot specific assumptions.

![](https://github.com/subos2008/binance-tool/workflows/DockerPublish/badge.svg)




# Ingress and Certs

https://www.digitalocean.com/community/tutorials/how-to-set-up-an-nginx-ingress-on-digitalocean-kubernetes-using-helm
