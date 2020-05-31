resource "kubernetes_secret" "amqp" {
  metadata {
    name      = "amqp"
    namespace = var.k8_namespace
  }
  type = "Opaque"
  data = {
    AMQP_HOST = var.AMQP_HOST
    AMQP_PROTOCOL = "amqps"
    AMQP_VHOST = var.AMQP_VHOST
    AMQP_USER = var.AMQP_CREATED_USER_USERNAME
    AMQP_PASSWORD = var.AMQP_CREATED_USER_PASSWORD
  }
}

