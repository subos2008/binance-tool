module "vhost" {
  source = "../../../modules/rabbitmq"

  vhost_name        = var.AMQP_VHOST
  new_user_name     = var.AMQP_CREATED_USER_USERNAME
  new_user_password = var.AMQP_CREATED_USER_PASSWORD
}

