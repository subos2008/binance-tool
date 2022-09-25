resource "digitalocean_vpc" "default" {
  name        = var.vpc_name
  region      = var.do_region
  description = "terraform managed"
}

data "digitalocean_kubernetes_versions" "example" {
  version_prefix = var.kubernetes_version_prefix
}

resource "digitalocean_kubernetes_cluster" "default" {
  depends_on = [digitalocean_vpc.default]

  name     = var.DIGITALOCEAN_CLUSTER_NAME
  region   = var.do_region
  vpc_uuid = digitalocean_vpc.default.id

  auto_upgrade  = true
  surge_upgrade = true
  version       = data.digitalocean_kubernetes_versions.example.latest_version


  maintenance_policy {
    start_time = "13:00"
    day        = "sunday"
  }

  node_pool {
    name       = "default-node-pool"
    size       = "g-2vcpu-8gb"
    auto_scale = true
    node_count = 1
    min_nodes  = 1
    max_nodes  = 1
  }
}
