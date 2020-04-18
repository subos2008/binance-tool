#!/bin/bash

helm upgrade --install services --namespace binance-tool --values ~/.env/binance-tool/services-values.yaml ./k8/charts/services
