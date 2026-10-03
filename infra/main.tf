data "aws_availability_zones" "available" { state = "available" }
locals {
  azs       = slice(data.aws_availability_zones.available.names, 0, 2)
  use_https = var.certificate_arn != ""
  port      = local.use_https ? 443 : 80
  oidc      = var.github_oidc_subject != ""
}
resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = "${var.project_name}-vpc" }
}
resource "aws_internet_gateway" "main" { vpc_id = aws_vpc.main.id }
resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = local.azs[count.index]
  tags              = { Name = "${var.project_name}-${count.index + 1}" }
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}
resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-alb-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port   = local.port
    to_port     = local.port
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
  }
  egress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }
}
resource "aws_security_group" "task" {
  name_prefix = "${var.project_name}-task-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_ecr_repository" "app" {
  name                 = var.project_name
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy     = jsonencode({ rules = [{ rulePriority = 1, description = "Keep latest 20 images", selection = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }, action = { type = "expire" } }] })
}
resource "aws_dynamodb_table" "app" {
  name         = var.project_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }
}
resource "aws_secretsmanager_secret" "dashboard" {
  name_prefix             = "${var.project_name}-dashboard-"
  recovery_window_in_days = 7
  description             = "CloudPulse dashboard Basic Auth password. Set its value using AWS CLI before starting tasks."
}
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.project_name}"
  retention_in_days = 14
}
resource "aws_ecs_cluster" "app" {
  name = var.project_name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}
resource "aws_lb" "app" {
  name                       = "${var.project_name}-alb"
  load_balancer_type         = "application"
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
}
resource "aws_lb_target_group" "app" {
  name                 = "${var.project_name}-app"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 15
  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}
resource "aws_lb_listener" "app" {
  load_balancer_arn = aws_lb.app.arn
  port              = local.port
  protocol          = local.use_https ? "HTTPS" : "HTTP"
  certificate_arn   = local.use_https ? var.certificate_arn : null
  ssl_policy        = local.use_https ? "ELBSecurityPolicy-TLS13-1-2-2021-06" : null
  lifecycle {
    precondition {
      condition     = !local.use_https || var.dashboard_domain != ""
      error_message = "Set dashboard_domain to a hostname covered by the ACM certificate."
    }
  }
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
resource "aws_ecs_task_definition" "app" {
  family                   = var.project_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = "cloudpulse", image = "${aws_ecr_repository.app.repository_url}:${var.image_tag}", essential = true,
    portMappings           = [{ containerPort = 3000, protocol = "tcp" }],
    readonlyRootFilesystem = true,
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "STORAGE", value = "dynamodb" },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "DYNAMODB_TABLE", value = aws_dynamodb_table.app.name },
      { name = "MONITOR_ALLOWED_HOSTS", value = join(",", var.monitor_allowed_hosts) },
      { name = "CHECK_INTERVAL_SECONDS", value = "60" }
    ],
    secrets          = [{ name = "DASHBOARD_TOKEN", valueFrom = aws_secretsmanager_secret.dashboard.arn }],
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = aws_cloudwatch_log_group.app.name, "awslogs-region" = var.aws_region, "awslogs-stream-prefix" = "app" } },
    healthCheck      = { command = ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""], interval = 30, timeout = 5, retries = 3, startPeriod = 20 }
  }])
}
resource "aws_ecs_service" "app" {
  name                              = var.project_name
  cluster                           = aws_ecs_cluster.app.id
  task_definition                   = aws_ecs_task_definition.app.arn
  desired_count                     = var.desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "cloudpulse"
    container_port   = 3000
  }
  depends_on = [aws_lb_listener.app, aws_iam_role_policy.execution, aws_iam_role_policy.task, aws_iam_role_policy_attachment.execution]
  # Application releases own the task revision; infrastructure owns service configuration.
  lifecycle { ignore_changes = [task_definition] }
}
