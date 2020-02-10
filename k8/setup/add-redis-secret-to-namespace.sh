#!/bin/bash

source ../../.env

kubectl create secret generic redis --from-literal=REDIS_HOST="$REDIS_HOST" --from-literal=REDIS_PASSWORD="$REDIS_PASSWORD" --namespace $1
