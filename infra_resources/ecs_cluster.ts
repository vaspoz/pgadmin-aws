import { Construct } from "constructs";
import {
  EcsCluster,
  EcsClusterCapacityProviders,
  EcsTaskDefinition,
} from "@cdktf/provider-aws/lib/ecs";
import { IamRole } from "@cdktf/provider-aws/lib/iam";
import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch";
import { Resource } from "@cdktf/provider-null";


export class PgadminEcsCluster extends Resource {

  public cluster: EcsCluster;

  private readonly tags: {};
  private readonly region: string;

  constructor(scope: Construct, id: string, tags: {}, region: string) {
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
    this.tags = tags;
    this.region = region;
  }

  public runDockerImage(name: string, image: string, env: Record<string, string | undefined>) {

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
      tags: this.tags,
      cpu: "256",
      memory: "512",
      requiresCompatibilities: ["FARGATE", "EC2"],
      networkMode: "awsvpc",
      executionRoleArn: taskRole.arn,
      taskRoleArn: taskRole.arn,
      containerDefinitions: JSON.stringify([
        {
          name,
          image,
          cpu: 256,
          memory: 512,
          command: ["echo", "Hello From ECS"],
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