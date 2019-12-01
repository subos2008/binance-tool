#!/bin/bash

source .env

set -xe

kubectl config set-context ${KUBECTL_CONTEXT}

kubectl run --generator=run-pod/v1 test-job-binance-tool --rm -i --tty --image ${DOCKER_REGISTRY}