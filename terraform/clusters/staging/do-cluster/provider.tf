terraform {
  required_version = "~> 1.3.0"

  required_providers {
    digitalocean = {
      source = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {
  token = var.DIGITALOCEAN_ACCESS_TOKEN
}
