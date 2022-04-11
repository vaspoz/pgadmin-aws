import { Construct } from "constructs";
import {
  EcsCluster,
  EcsClusterCapacityProviders,
  EcsTaskDefinition,
} from "@cdktf/provider-aws/lib/ecs";
import { IamRole } from "@cdktf/provider-aws/lib/iam";
import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch";
import { Resource } from "@cdktf/provider-null";
import { DataAwsEcrAuthorizationToken, EcrRepository } from "@cdktf/provider-aws/lib/ecr";
import * as path from "path";
import { ITerraformDependable } from "cdktf";


export class PgadminEcsCluster extends Resource {

  public cluster: EcsCluster;
  public image: Resource;

  private readonly tags: {};
  private readonly imageTag: string;

  private region = "eu-central-1";

  constructor(scope: Construct, id: string, tags: {}, dependsOn: ITerraformDependable[]) {
    super(scope, id);

    const cluster = new EcsCluster(this, `ecs-${id}`, {
      name: id,
      tags,
    });

    new EcsClusterCapacityProviders(this, `capacity-providers-${id}`, {
      clusterName: cluster.name,
      capacityProviders: ["FARGATE"],
    });

    // Create ECR
    const repo = new EcrRepository(this, "ecr", {
      name: `${id}-repo`,
      tags
    });
    // get the authorization for ECR
    const auth = new DataAwsEcrAuthorizationToken(this, "auth", {
      dependsOn: [repo],
      registryId: repo.registryId
    });

    this.imageTag = `${repo.repositoryUrl}:1.0.0`;
    this.image = new Resource(this, "pgadmin-image", {
      dependsOn: dependsOn
    });
    this.image.addOverride("provisioner.local-exec.command",
      `
        docker logout &&
        docker login -u ${auth.userName} -p ${auth.password} ${auth.proxyEndpoint} &&
        docker build -t ${this.imageTag} ${path.resolve(__dirname)} &&
        docker push ${this.imageTag}
      `
    );

    this.cluster = cluster;
    this.tags = tags;
  }

  public runDockerImage = (name: string, env: Record<string, string | undefined>) => {

    const executionRole = new IamRole(this, `execution-role`, {
      name: `${name}-execution-role`,
      tags: this.tags,
      inlinePolicy: [
        {
          name: "allow-ecr-pull",
          policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "ecr:GetAuthorizationToken",
                  "ecr:BatchCheckLayerAvailability",
                  "ecr:GetDownloadUrlForLayer",
                  "ecr:BatchGetImage",
                  "logs:CreateLogStream",
                  "logs:PutLogEvents",
                ],
                Resource: "*",
              },
            ],
          }),
        },
      ],
      // this role shall only be used by an ECS task
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Sid: "",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
          },
        ],
      }),
    });
    // Role that allows us to push logs
    const taskRole = new IamRole(this, "task-role", {
      name: `${name}-task-role`,
      tags: this.tags,
      inlinePolicy: [
        {
          name: "allow-logs",
          policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
                Resource: "*",
              },
            ],
          }),
        },
      ],
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Sid: "",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
          },
        ],
      }),
    });

    // Creates a log group for the task
    const logGroup = new CloudwatchLogGroup(this, "loggroup", {
      name: `${this.cluster.name}/${name}`,
      retentionInDays: 30,
      tags: this.tags,
    });

    // Creates a task that runs the docker container
    const task = new EcsTaskDefinition(this, "pgadmin-task", {
      dependsOn: [this.image],
      tags: this.tags,
      cpu: "256",
      memory: "512",
      requiresCompatibilities: ["FARGATE", "EC2"],
      networkMode: "awsvpc",
      executionRoleArn: executionRole.arn,
      taskRoleArn: taskRole.arn,
      containerDefinitions: JSON.stringify([
        {
          name,
          image: this.imageTag,
          cpu: 256,
          memory: 512,
          environment: Object.entries(env).map(([name, value]) => ({
            name,
            value,
          })),
          essential: true,
          portMappings: [
            {
              containerPort: 80,
              hostPort: 80,
              protocol: "tcp"
            },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroup.name,
              "awslogs-region": this.region,
              "awslogs-stream-prefix": name,
            },
          },
        },
      ]),
      family: "service",
    });

    return task;
  }
}