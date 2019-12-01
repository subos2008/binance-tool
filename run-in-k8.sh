#!/bin/bash

source .env

set -xe

kubectl config set-context ${KUBECTL_CONTEXT}

cd k8/run-in-k8
node index.js
