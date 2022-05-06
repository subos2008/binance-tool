#!/bin/bash

source ../../.env

kubectl patch serviceaccount --namespace $1 default -p '{"imagePullSecrets": [{"name": "regcred"}]}'
