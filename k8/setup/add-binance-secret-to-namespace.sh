#!/bin/bash

source ../../.env

kubectl create secret generic binance --from-literal=BINANCE_API_KEY="$BINANCE_API_KEY" --from-literal=BINANCE_API_SECRET="$BINANCE_API_SECRET" --namespace $1
