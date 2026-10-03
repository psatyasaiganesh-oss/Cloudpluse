output "dashboard_url" { value = local.use_https ? "https://${var.dashboard_domain}" : "http://${aws_lb.app.dns_name}" }
output "alb_dns_name" { value = aws_lb.app.dns_name }
output "ecr_url" { value = aws_ecr_repository.app.repository_url }
output "ecs_cluster" { value = aws_ecs_cluster.app.name }
output "ecs_service" { value = aws_ecs_service.app.name }
output "dashboard_secret_arn" { value = aws_secretsmanager_secret.dashboard.arn }
output "deploy_role_arn" { value = try(aws_iam_role.github[0].arn, null) }
output "cloudwatch_log_group" { value = aws_cloudwatch_log_group.app.name }
