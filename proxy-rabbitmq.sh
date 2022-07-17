#!/bin/bash

# export POD_NAME=$(/usr/local/bin/kubectl get pods --namespace persistent-state -l "app=rabbitmq" -o jsonpath="{.items[0].metadata.name}")
# /usr/local/bin/kubectl port-forward $POD_NAME --namespace persistent-state 5672:5672 15672:15672


echo "URL : http://localhost:15672/"
kubectl port-forward --namespace persistent-state svc/shared-amqp-rabbitmq 15672:15672 5672:5672
