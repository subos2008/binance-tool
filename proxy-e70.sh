#!/bin/bash

kubectl port-forward --namespace binance-tool svc/edge70-signals 6070:80
