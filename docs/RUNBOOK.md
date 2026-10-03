# Incident runbook

## A service is down

1. Open its latest check. Confirm whether the probe is simulated or live, the status code, and the endpoint.
2. Acknowledge the incident and record symptoms, impact, and time.
3. For a live service, inspect its application logs, recent release, DNS, TLS certificate, and upstream dependencies.
4. For CloudPulse on AWS, inspect ECS service events, stopped task reasons, target-group health, and the CloudWatch log group.
5. If a release introduced the fault, return to the last healthy task revision. Wait for healthy targets and then run a check.
6. Record the cause and fix. Automatic incidents resolve when the next probe is healthy; manually reported incidents require manual resolution.

## Elevated latency

Check the response history and verify the threshold (1,000 ms). Inspect CPU, memory, database throttling, upstream calls, and request volumes. Increasing task count helps only when the application workload is the constraint; it does not fix a slow monitored upstream service.

## Dashboard returns 503

Check the database binding or table name, IAM permissions, D1 migration status, and database availability. `/api/health` depends on storage readiness. Never treat a storage failure as successful monitoring. Retry after the underlying failure is corrected.

## ECS cannot start a task

Verify that the ECR image tag exists, Secrets Manager has a current value, the execution role can retrieve it, the task role can access DynamoDB, and the Fargate task has outbound HTTPS access. Confirm the password is at least 24 characters.

## No alert email

Confirm the SNS subscription through the verification email and inspect the CloudWatch alarm state. SNS notifications in this project come from AWS CPU and target-health alarms. App incident creation is visible in CloudPulse and does not automatically send an email.

## Practice exercise

Make Commerce API unavailable, run checks, acknowledge the P1 incident, restore its state, and verify automatic recovery. Add a manual warning incident and resolve it with a note. Restart locally and confirm the history remains.
