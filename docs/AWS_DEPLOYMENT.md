# Deploy CloudPulse on AWS

This guide provisions the included AWS infrastructure. The private hosted demo does not provision your AWS account. Terraform creates billable resources, including an ALB, CloudWatch resources, ECR, DynamoDB, and optional Fargate tasks. Review your own region's pricing and destroy the lab when finished; no free-tier assumption or fixed cost estimate is made.

## Prerequisites

- AWS CLI v2 configured with permissions to create the listed infrastructure.
- Terraform 1.10.5 (the CI version), Docker with a running daemon, and Git.
- A trusted public IPv4 address/CIDR for dashboard access.
- For TLS: a domain you control and a validated ACM certificate in `ap-south-1`, or your selected region.

Keep credentials, Terraform state, passwords, and `.env` out of Git. The repository ignores them. For team use, configure an encrypted remote Terraform state backend and locking before applying; this lab initially uses local state.

## 1. Bootstrap infrastructure

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

Replace `allowed_cidrs` with your public IP CIDR (for example, your real address followed by `/32`). Keep `desired_count = 0`. If you have an ACM certificate, also set `certificate_arn` and `dashboard_domain` to the matching domain.

```bash
terraform -chdir=infra init
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
terraform -chdir=infra plan -out=reviewed.plan
terraform -chdir=infra apply reviewed.plan
```

Review the plan before applying. Bootstrap creates a task definition referencing the `bootstrap` image but starts no tasks until the image and dashboard secret exist.

## 2. Set the dashboard password

Generate the password into a temporary file, store it in a password manager, and supply it to Secrets Manager. The secret value is deliberately managed outside Terraform so it does not enter Terraform state.

```bash
openssl rand -hex 24 | tr -d '\n' > dashboard-token.txt
secret_arn=$(terraform -chdir=infra output -raw dashboard_secret_arn)
aws secretsmanager put-secret-value --secret-id "$secret_arn" --secret-string file://dashboard-token.txt --region ap-south-1
```

Use any username and this value as the browser password. Delete the temporary file after securely storing the password. It is ignored by Git. The unauthenticated `/api/health` route is used only for readiness; all other dashboard and API routes require the password in production.

## 3. Build and upload the first image

Run from the project root:

```bash
ecr_url=$(terraform -chdir=infra output -raw ecr_url)
registry=${ecr_url%%/*}
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin "$registry"
docker build --platform linux/amd64 -t "$ecr_url:bootstrap" .
docker push "$ecr_url:bootstrap"
```

ECR tags are immutable. Use a fresh tag for later releases rather than overwriting `bootstrap`.

## 4. Start the service

Set `desired_count = 1` in `infra/terraform.tfvars`, then review and apply:

```bash
terraform -chdir=infra plan -out=reviewed.plan
terraform -chdir=infra apply reviewed.plan
aws ecs wait services-stable --cluster cloudpulse --services cloudpulse --region ap-south-1
terraform -chdir=infra output dashboard_url
```

Use your configured project name if different. For TLS, create a DNS CNAME (or Route 53 alias) from `dashboard_domain` to the `alb_dns_name` output. The certificate must cover that domain; the ALB's AWS-generated DNS name is not covered by your custom certificate. Port 80 is used only when no certificate is configured; restrict it to your own CIDR for a temporary lab and enable TLS before entering real data or using the dashboard outside that lab.

Visit the output URL and authenticate. Inspect ECS task and target health, then run a health check in CloudPulse. Confirm persistence by refreshing the page and by replacing a Fargate task.

If `alert_email` is set, confirm the SNS email subscription. CloudWatch alerts cover high ECS CPU utilization, unhealthy ALB targets, and a running service with no healthy targets. They do not send an email for every CloudPulse incident.

## 5. Configure GitHub Actions OIDC deployment

Push this project to your own GitHub repository. The build does not automatically create or push a GitHub repository.

Set `github_oidc_subject` to the exact `sub` claim for that repository's `main` branch. GitHub's current documentation distinguishes older name-based subjects from immutable subjects used by newly created repositories:

```text
repo:OWNER/REPOSITORY:ref:refs/heads/main
repo:OWNER@OWNER_ID/REPOSITORY@REPOSITORY_ID:ref:refs/heads/main
```

Use the format your repository actually emits. GitHub owner/repository numeric IDs can be read from the repository API; do not copy placeholder IDs. The supplied workflow does not declare a GitHub environment, so its subject is branch-based. If you add an environment, update the exact trust subject accordingly. This lab validation currently restricts it to main.

If your AWS account already has the `token.actions.githubusercontent.com` IAM OIDC provider, set `github_oidc_provider_arn` to its existing ARN to avoid trying to create a duplicate provider. Apply the Terraform update.

Set these GitHub repository **Actions variables**:

| Variable | Value |
| --- | --- |
| `AWS_ROLE_ARN` | `deploy_role_arn` Terraform output |
| `AWS_REGION` | `ap-south-1` or your region |
| `ECR_REPOSITORY` | `cloudpulse` or your project name |
| `ECS_CLUSTER` | `ecs_cluster` output |
| `ECS_SERVICE` | `ecs_service` output |

Run **Deploy CloudPulse to ECS** manually from `main`. It validates the application, uses OIDC to assume the deployment role, builds/pushes a uniquely tagged image, registers an ECS task revision, deploys it, and checks that ECS did not roll back. No permanent AWS access-key secrets are needed by this workflow.

The workflow intentionally does not apply Terraform. Infrastructure changes are reviewed and applied separately. Terraform ignores the service's `task_definition` revision so a later infrastructure apply does not revert a successful application release.

## Recovery and cleanup

Use ECS service events and CloudWatch logs when a release fails. The service enables the ECS deployment circuit breaker with rollback. For manual rollback, select a previously healthy task revision in ECS and update the service to that revision.

When finished, review `terraform -chdir=infra plan -destroy` and run `terraform -chdir=infra destroy`. ECR deletion fails if images remain; delete the project's images first if intentionally destroying the lab. The secret is scheduled for deletion after seven days. Do not lose Terraform state before cleanup.

## Official references

- [AWS Fargate outbound networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html)
- [ECS CloudWatch monitoring](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cloudwatch-metrics.html)
- [GitHub OIDC on AWS and exact subject claims](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [Terraform AWS ECS service resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_service)
