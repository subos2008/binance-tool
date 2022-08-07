#!/bin/bash

time ./services/edge70-signals/backtesting/run.sh | ./node_modules/bunyan/bin/bunyan -o short
