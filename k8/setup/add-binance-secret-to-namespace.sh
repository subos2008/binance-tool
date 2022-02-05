#!/bin/bash

source ../../.env

kubectl create secret generic binance --from-literal=BINANCE_API_KEY="$APIKEY" --from-literal=BINANCE_API_SECRET="$APISECRET" --namespace $1
