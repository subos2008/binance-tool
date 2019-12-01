#!/bin/bash

source .env

JOB_NAME=test-job-binance-tool

set -xe

kubectl config set-context ${KUBECTL_CONTEXT}

# kubectl run \
#     --generator=run-pod/v1 \
#     test-job-binance-tool \
#     --rm -i --tty \
#     --env="TELEGRAM_KEY=$TELEGRAM_KEY" \
#     --env="TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID" \
    # end

# -i --tty --rm

 kubectl run \
    --generator=run-pod/v1 \
    $JOB_NAME \
    --overrides='
{
  "spec": {
    "containers": [
      {
        "name": "test-job-binance-tool",
        "image": "docker.pkg.github.com/subos2008/binance-tool/binance-tool",
        "env": [
          {
            "name": "TELEGRAM_KEY",
            "valueFrom": {
              "secretKeyRef": {
                "name": "telegram",
                "key": "TELEGRAM_KEY"
              }
            }
          },
          {
            "name": "TELEGRAM_CHAT_ID",
            "valueFrom": {
              "secretKeyRef": {
                "name": "telegram",
                "key": "TELEGRAM_CHAT_ID"
              }
            }
          }
        ]
      }
    ]
  }
}
'  --image ${DOCKER_REGISTRY} --dry-run -o yaml