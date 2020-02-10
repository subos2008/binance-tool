#!/bin/bash

source ../../.env

kubectl create secret generic binance --from-literal=APIKEY="$APIKEY" --from-literal=APISECRET="$APISECRET" --namespace $1