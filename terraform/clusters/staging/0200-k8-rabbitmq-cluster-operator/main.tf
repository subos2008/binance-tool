
locals {
  url = "https://github.com/rabbitmq/cluster-operator/releases/download/v${var.rabbitmq_cluster_operator_version}/cluster-operator.yml"
}


resource "null_resource" "kubectl" {
    provisioner "local-exec" {
        command = "kubectl apply -f \"${local.url}\""
    }
}
