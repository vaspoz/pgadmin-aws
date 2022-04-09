import { Construct } from "constructs";
import {
  EcsCluster,
  EcsClusterCapacityProviders,
  EcsTaskDefinition,
} from "@cdktf/provider-aws/lib/ecs";
import { IamRole } from "@cdktf/provider-aws/lib/iam";
import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch";
import { Resource } from "@cdktf/provider-null";

const REGION = "eu-central-1";

const tags = {
  iac: "terraform",
  tool: "cdktf",
  owner: "basilp"
};

export class PgadminEcsCluster extends Resource {
  public cluster: EcsCluster;
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cluster = new EcsCluster(this, `ecs-${id}`, {
      name: id,
      tags,
    });

    new EcsClusterCapacityProviders(this, `capacity-providers-${id}`, {
      clusterName: cluster.name,
      capacityProviders: ["FARGATE"],
    });

    this.cluster = cluster;
  }

  public runDockerImage(
    name: string,
    image: string,
    env: Record<string, string | undefined>
  ) {
    // Role that allows us to get the Docker image
    const executionRole = new IamRole(this, `execution-role`, {
      name: `${name}-execution-role`,
      tags,
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
    const taskRole = new IamRole(this, `task-role`, {
      name: `${name}-task-role`,
      tags,
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
    const logGroup = new CloudwatchLogGroup(this, `loggroup`, {
      name: `${this.cluster.name}/${name}`,
      retentionInDays: 30,
      tags,
    });

    // Creates a task that runs the docker container
    const task = new EcsTaskDefinition(this, `task`, {
      tags,
      cpu: "256",
      memory: "512",
      requiresCompatibilities: ["FARGATE", "EC2"],
      networkMode: "awsvpc",
      executionRoleArn: executionRole.arn,
      taskRoleArn: taskRole.arn,
      containerDefinitions: JSON.stringify([
        {
          name,
          image,
          cpu: 256,
          memory: 512,
          command: ['echo Hello From ECS'],
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
              // Defines the log
              "awslogs-group": logGroup.name,
              "awslogs-region": REGION,
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