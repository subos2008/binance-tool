#!/bin/bash

kubectl port-forward --namespace persistent-state svc/bitnami-redis-master 6379:6379
