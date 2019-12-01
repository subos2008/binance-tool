#!/bin/bash

source .env

kubectl config set-context ${KUBECTL_CONTEXT}
