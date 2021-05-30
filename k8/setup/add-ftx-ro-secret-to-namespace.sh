#!/bin/bash

source ../../.env

kubectl create secret generic ftx-ro --from-literal=FTX_RO_APIKEY="$FTX_RO_APIKEY" --from-literal=FTX_RO_APISECRET="$FTX_RO_APISECRET" --namespace $1
