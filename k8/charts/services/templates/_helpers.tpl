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
helm.sh/chart: {{ include "mychart.chart" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
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

{{- define "binance.vars" -}}
- name: APIKEY
  valueFrom:
    secretKeyRef:
      key: APIKEY
      name: binance
- name: APISECRET
  valueFrom:
    secretKeyRef:
      key: APISECRET
      name: binance
{{- end -}}

