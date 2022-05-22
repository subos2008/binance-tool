#!/bin/bash

source ../../.env
source ../../.env-in-cluster

kubectl create secret generic telegram-bot-bert --from-literal=TELEGRAM_KEY="$TELEGRAM_BOT_BERT_KEY" --namespace $1
