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

Adding secrets can be done with the scripts here if you have a `.env` with the values in.

You will need to add the `user` and `exchange` to AMQP that is used by some of these services.

`redis` also needs to be configured.

![](https://github.com/subos2008/binance-tool/workflows/DockerPublish/badge.svg)


# Ingress and Certs

https://www.digitalocean.com/community/tutorials/how-to-set-up-an-nginx-ingress-on-digitalocean-kubernetes-using-helm
