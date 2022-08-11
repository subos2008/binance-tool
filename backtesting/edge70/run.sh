#!/bin/bash

source .env-backtest

export INFLUXDB_TOKEN
export INFLUXDB_HOST
export INFLUXDB_ORG_ID
export INFLUXDB_BUCKET
export GRAFANA_HOST

./node_modules/.bin/ts-node ./backtesting/edge70/edge70-mega-backtester.ts
