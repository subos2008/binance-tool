variable "DIGITALOCEAN_ACCESS_TOKEN" {}

variable "DIGITALOCEAN_CLUSTER_NAME" {
  description = "Used as a key in the path for the tf state - do not change after creation"
}

variable "rabbitmq_cluster_operator_version" {
  default = "1.14.0" # v2 requires k8 v1.25
}
