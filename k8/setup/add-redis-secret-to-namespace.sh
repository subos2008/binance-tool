#!/bin/bash

source ../../.env
source ../../.env-in-cluster

kubectl create secret generic redis --from-literal=REDIS_HOST="$REDIS_HOST" --from-literal=REDIS_DATABASE_NUMBER="$REDIS_DATABASE_NUMBER" --from-literal=REDIS_PASSWORD="$REDIS_PASSWORD" --namespace $1
# kubectl create secret generic redis-auth --from-literal=password="$REDIS_PASSWORD" --namespace $1
# kubectl create secret generic redis-auth --from-literal=password="$REDIS_PASSWORD" --namespace persistent-state

