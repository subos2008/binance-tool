#!/bin/bash

source .env

set -xe

kubectl config set-context ${KUBECTL_CONTEXT}

export TRADE_ID=$1

if [[ -z "$TRADE_ID" ]] 
then
    echo "Error: Supply trade ID"
    exit 1
else 
    echo "Trade ID $TRADE_ID"
fi

cd k8/run-in-k8
node index.js
