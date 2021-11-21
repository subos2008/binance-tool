#!/bin/bash

source ../../.env

kubectl create secret generic telegram-bot-bert --from-literal=TELEGRAM_KEY="$TELEGRAM_BOT_BERT_KEY" --namespace $1
