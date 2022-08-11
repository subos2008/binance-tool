#!/bin/bash

source .env-backtest
./node_modules/.bin/ts-node ./backtesting/edge70/edge70-mega-backtester.ts
