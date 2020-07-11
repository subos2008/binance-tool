#!/bin/bash

./create-trade -p FOOBAR -b 1 -t 2 -s 0.9

./service --trade-id 1 --live=false
