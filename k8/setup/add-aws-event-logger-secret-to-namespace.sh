#!/bin/bash

source ../../.env

kubectl create secret generic aws-event-logger --from-literal=AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" --from-literal=AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" --namespace $1
