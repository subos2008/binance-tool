#!/bin/bash

source ../../.env
source ../../.env-in-cluster

kubectl create secret generic influxdb --from-literal=INFLUXDB_HOST="$INFLUXDB_HOST" --from-literal=INFLUXDB_TOKEN="$INFLUXDB_TOKEN" --from-literal=INFLUXDB_ORG_ID="$INFLUXDB_ORG_ID" --namespace $1
