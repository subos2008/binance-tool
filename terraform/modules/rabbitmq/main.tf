# Create a virtual host
resource "rabbitmq_vhost" "default" {
  name = var.vhost_name
}

resource "rabbitmq_user" "default" {
  name     = var.new_user_name
  password = var.new_user_password
  tags     = []
}

resource "rabbitmq_permissions" "default" {
  user  = rabbitmq_user.default.name
  vhost = rabbitmq_vhost.default.name

  permissions {
    configure = ".*"
    write     = ".*"
    read      = ".*"
  }
}
