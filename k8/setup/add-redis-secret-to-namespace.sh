#!/bin/bash

source ../../.env

kubectl create secret generic redis --from-literal=REDIS_HOST="$REDIS_HOST" --namespace $1
kubectl create secret generic redis-auth --from-literal=password="$REDIS_PASSWORD" --namespace $1
kubectl create secret generic redis-auth --from-literal=password="$REDIS_PASSWORD" --namespace persistent-state
