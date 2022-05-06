#!/bin/bash

source ../../.env
source ../../.env-in-cluster

kubectl create secret generic amqp  --namespace $1 \
  --from-literal=AMQP_HOST="$AMQP_HOST" \
  --from-literal=AMQP_PROTOCOL="$AMQP_PROTOCOL" \
  --from-literal=AMQP_VHOST="$AMQP_VHOST" \
  --from-literal=AMQP_USER="$AMQP_USER" \
  --from-literal=AMQP_PASSWORD="$AMQP_PASSWORD"
