#!/bin/bash

source ../../.env

kubectl create secret generic mongodb-wo --from-literal=MONGODB_URL="$MONGODB_WO_URL" --namespace $1
