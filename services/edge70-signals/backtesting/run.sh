#!/bin/bash

source .env-backtest
./node_modules/.bin/ts-node ./services/edge70-signals/backtesting/edge70-mega-backtester.ts
