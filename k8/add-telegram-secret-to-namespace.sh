#!/bin/bash

source .env

kubectl create secret generic telegram --from-literal=TELEGRAM_KEY="$TELEGRAM_KEY" --from-literal=TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" --namespace $1