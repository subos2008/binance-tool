resource "kubernetes_namespace" "default" {
  metadata {
    name = var.k8_namespace
  }
}
