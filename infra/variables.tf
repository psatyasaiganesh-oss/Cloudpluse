variable "aws_region" {
  type    = string
  default = "ap-south-1"
}
variable "project_name" {
  type    = string
  default = "cloudpulse"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.project_name))
    error_message = "Use 3–20 lowercase letters, digits, or hyphens, starting with a letter."
  }
}
variable "image_tag" {
  type    = string
  default = "bootstrap"
}
variable "desired_count" {
  type    = number
  default = 0
  validation {
    condition     = var.desired_count >= 0 && var.desired_count <= 4 && floor(var.desired_count) == var.desired_count
    error_message = "Desired count must be an integer from 0 to 4."
  }
}
variable "allowed_cidrs" {
  type = list(string)
  validation {
    condition     = length(var.allowed_cidrs) > 0 && alltrue([for c in var.allowed_cidrs : can(cidrnetmask(c)) && c != "0.0.0.0/0"])
    error_message = "Provide your trusted IPv4 CIDRs; 0.0.0.0/0 is not accepted."
  }
}
variable "certificate_arn" {
  type        = string
  default     = ""
  description = "Existing ACM certificate in this region; empty enables a restricted HTTP lab only."
}
variable "dashboard_domain" {
  type        = string
  default     = ""
  description = "Domain covered by the ACM certificate. Point its DNS CNAME to the ALB DNS name."
}
variable "monitor_allowed_hosts" {
  type    = list(string)
  default = []
}
variable "alert_email" {
  type    = string
  default = ""
}
variable "github_oidc_subject" {
  type        = string
  default     = ""
  description = "Exact GitHub OIDC sub for the repository's main branch. Empty disables the deploy role."
  validation {
    condition     = var.github_oidc_subject == "" || (startswith(var.github_oidc_subject, "repo:") && endswith(var.github_oidc_subject, ":ref:refs/heads/main") && !strcontains(var.github_oidc_subject, "*"))
    error_message = "Use the exact repo OIDC subject for main, without wildcards."
  }
}
variable "github_oidc_provider_arn" {
  type        = string
  default     = ""
  description = "Reuse an existing GitHub IAM OIDC provider ARN, or leave empty to create one if deploying with OIDC."
}
