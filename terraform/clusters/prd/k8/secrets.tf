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

resource "kubernetes_secret" "redis-auth" {
  metadata {
    name      = "redis-auth"
    namespace = var.k8_namespace
  }
  type = "Opaque"
  data = {
    password = var.REDIS_AUTH
  }
}

resource "kubernetes_secret" "redis" {
  metadata {
    name      = "redis"
    namespace = var.k8_namespace
  }
  type = "Opaque"
  data = {
    REDIS_HOST = var.REDIS_HOST
    REDIS_PASSWORD = var.REDIS_AUTH
  }
}
