data "aws_iam_policy_document" "ecs_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}
resource "aws_iam_role" "execution" {
  name_prefix        = "${var.project_name}-exec-"
  assume_role_policy = data.aws_iam_policy_document.ecs_trust.json
}
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role_policy" "execution" {
  role   = aws_iam_role.execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.dashboard.arn }] })
}
resource "aws_iam_role" "task" {
  name_prefix        = "${var.project_name}-task-"
  assume_role_policy = data.aws_iam_policy_document.ecs_trust.json
}
resource "aws_iam_role_policy" "task" {
  role   = aws_iam_role.task.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:DescribeTable"], Resource = aws_dynamodb_table.app.arn }] })
}
resource "aws_iam_openid_connect_provider" "github" {
  count          = local.oidc && var.github_oidc_provider_arn == "" ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}
locals {
  github_provider = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : try(aws_iam_openid_connect_provider.github[0].arn, "")
}
resource "aws_iam_role" "github" {
  count       = local.oidc ? 1 : 0
  name_prefix = "${var.project_name}-deploy-"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Action = "sts:AssumeRoleWithWebIdentity", Principal = { Federated = local.github_provider },
    Condition = { StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com", "token.actions.githubusercontent.com:sub" = var.github_oidc_subject } }
  }] })
}
resource "aws_iam_role_policy" "github" {
  count = local.oidc ? 1 : 0
  role  = aws_iam_role.github[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage"], Resource = aws_ecr_repository.app.arn },
    { Effect = "Allow", Action = ["ecs:DescribeServices", "ecs:UpdateService"], Resource = aws_ecs_service.app.id },
    { Effect = "Allow", Action = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"], Resource = "*" },
    { Effect = "Allow", Action = ["iam:PassRole"], Resource = [aws_iam_role.execution.arn, aws_iam_role.task.arn], Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } } }
  ] })
}
