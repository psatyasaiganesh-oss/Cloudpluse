resource "aws_sns_topic" "alerts" { name = "${var.project_name}-alerts" }
resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
resource "aws_cloudwatch_metric_alarm" "cpu" {
  alarm_name          = "${var.project_name}-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  dimensions          = { ClusterName = aws_ecs_cluster.app.name, ServiceName = aws_ecs_service.app.name }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_metric_alarm" "unhealthy" {
  alarm_name          = "${var.project_name}-unhealthy-targets"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { LoadBalancer = aws_lb.app.arn_suffix, TargetGroup = aws_lb_target_group.app.arn_suffix }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_metric_alarm" "no_healthy" {
  alarm_name          = "${var.project_name}-no-healthy-targets"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1
  treat_missing_data  = var.desired_count > 0 ? "breaching" : "notBreaching"
  dimensions          = { LoadBalancer = aws_lb.app.arn_suffix, TargetGroup = aws_lb_target_group.app.arn_suffix }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_dashboard" "app" {
  dashboard_name = var.project_name
  dashboard_body = jsonencode({ widgets = [
    { type = "metric", x = 0, y = 0, width = 12, height = 6, properties = { title = "ECS utilization", region = var.aws_region, metrics = [["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.app.name, "ServiceName", aws_ecs_service.app.name], ["AWS/ECS", "MemoryUtilization", "ClusterName", aws_ecs_cluster.app.name, "ServiceName", aws_ecs_service.app.name]], period = 60, stat = "Average" } },
    { type = "metric", x = 12, y = 0, width = 12, height = 6, properties = { title = "Load balancer health", region = var.aws_region, metrics = [["AWS/ApplicationELB", "HealthyHostCount", "LoadBalancer", aws_lb.app.arn_suffix, "TargetGroup", aws_lb_target_group.app.arn_suffix], ["AWS/ApplicationELB", "UnHealthyHostCount", "LoadBalancer", aws_lb.app.arn_suffix, "TargetGroup", aws_lb_target_group.app.arn_suffix]], period = 60, stat = "Maximum" } }
  ] })
}
