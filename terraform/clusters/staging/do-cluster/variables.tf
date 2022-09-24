variable "DIGITALOCEAN_ACCESS_TOKEN" {}
variable "do_region" {}

variable vpc_name {}
variable DIGITALOCEAN_CLUSTER_NAME {
  description = "Used as a key in the path for the tf state - do not change after creation"
}
