#!/bin/bash

source ../../.env
source ../../.env-in-cluster

kubectl patch serviceaccount --namespace $1 default -p '{"imagePullSecrets": [{"name": "regcred"}]}'
