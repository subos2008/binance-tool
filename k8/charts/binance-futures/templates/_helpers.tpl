{{/*
Expand the name of the chart.
*/}}
{{- define "binance-futures.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "binance-futures.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "binance-futures.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "binance-futures.labels" -}}
helm.sh/chart: {{ include "binance-futures.chart" . }}
{{ include "binance-futures.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "binance-futures.selectorLabels" -}}
app.kubernetes.io/name: {{ include "binance-futures.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "binance-futures.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "binance-futures.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

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


{{- define "binance-futures.vars" -}}
- name: BINANCE_API_KEY
  valueFrom:
    secretKeyRef:
      key: BINANCE_API_KEY
      name: binance-futures
- name: BINANCE_API_SECRET
  valueFrom:
    secretKeyRef:
      key: BINANCE_API_SECRET
      name: binance-futures
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
