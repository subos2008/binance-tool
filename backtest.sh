#!/bin/bash

source .env-backtest

# export SENTRY_DSN
export INFLUXDB_TOKEN
export INFLUXDB_HOST
export INFLUXDB_ORG_ID
export INFLUXDB_BUCKET
export GRAFANA_HOST

time ./services/edge70-signals/backtesting/run.sh | ./node_modules/bunyan/bin/bunyan -o short
