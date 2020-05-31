variable "AMQP_ADMIN_PASSWORD" {}
variable "AMQP_ENDPOINT" {
  default = "http://127.0.0.1:15672"
}
variable "AMQP_ADMIN_USERNAME" {}

variable "AMQP_VHOST" {
  default = "binance-tool"
}

variable "AMQP_CREATED_USER_USERNAME" {
  default = "binance-tool-shared"
}

variable "AMQP_CREATED_USER_PASSWORD" { }

