provider "kubernetes" {
  # config_context_auth_info = "ops"
  config_context_cluster   = var.k8_context_name
}

