#!/bin/bash

source ../../.env

kubectl patch serviceaccount --namespace ${KUBECTL_NAMESPACE} default -p '{"imagePullSecrets": [{"name": "regcred"}]}'