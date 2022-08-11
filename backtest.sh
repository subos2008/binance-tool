#!/bin/bash

# Target file contains exports

time ./backtesting/edge70/run.sh | ./node_modules/bunyan/bin/bunyan -o short
