{{/* vim: set filetype=mustache: */}}
{{/*
Expand the name of the chart.
*/}}
{{- define "mychart.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "mychart.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "mychart.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels
*/}}
{{- define "mychart.labels" -}}
app.kubernetes.io/name: {{ include "mychart.name" . }}
{{- end -}}

{{/*
Environment variables
*/}}
{{- define "amqp.vars" -}}
- name: AMQP_HOST
  valueFrom:
    secretKeyRef:
      key: AMQP_HOST
      name: amqp
- name: AMQP_PROTOCOL
  valueFrom:
    secretKeyRef:
      key: AMQP_PROTOCOL
      name: amqp
- name: AMQP_VHOST
  valueFrom:
    secretKeyRef:
      key: AMQP_VHOST
      name: amqp
- name: AMQP_USER
  valueFrom:
    secretKeyRef:
      key: AMQP_USER
      name: amqp
- name: AMQP_PASSWORD
  valueFrom:
    secretKeyRef:
      key: AMQP_PASSWORD
      name: amqp
{{- end -}}

{{- define "binance-spot-ro.vars" -}}
- name: BINANCE_API_KEY
  valueFrom:
    secretKeyRef:
      key: BINANCE_API_KEY
      name: binance-spot-ro
- name: BINANCE_API_SECRET
  valueFrom:
    secretKeyRef:
      key: BINANCE_API_SECRET
      name: binance-spot-ro
{{- end -}}

{{- define "datadog.vars" -}}
- name: DD_LOGS_INJECTION
  value: "true"
- name: DD_AGENT_HOST
  valueFrom:
    fieldRef:
      fieldPath: status.hostIP
- name: DD_SERVICE
  valueFrom:
    fieldRef:
      fieldPath: metadata.labels['tags.datadoghq.com/service']
{{- end -}}

{{- define "redis.vars" -}}
- name: REDIS_HOST
  valueFrom:
    secretKeyRef:
      key: REDIS_HOST
      name: redis
- name: REDIS_DATABASE_NUMBER
  value: {{ .Values.redis.database_number | quote }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: redis
      key: REDIS_PASSWORD    
{{- end -}}

{{- define "telegram.vars" -}}
- name: TELEGRAM_KEY
  valueFrom:
    secretKeyRef:
      key: TELEGRAM_KEY
      name: telegram
- name: TELEGRAM_CHAT_ID
  valueFrom:
    secretKeyRef:
      key: TELEGRAM_CHAT_ID
      name: telegram
{{- end -}}

{{- define "influxdb.vars" -}}
- name: INFLUXDB_HOST
  valueFrom:
    secretKeyRef:
      key: INFLUXDB_HOST
      name: influxdb
- name: INFLUXDB_TOKEN
  valueFrom:
    secretKeyRef:
      key: INFLUXDB_TOKEN
      name: influxdb
- name: INFLUXDB_ORG_ID
  valueFrom:
    secretKeyRef:
      key: INFLUXDB_ORG_ID
      name: influxdb
{{- end -}}
