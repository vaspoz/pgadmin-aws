import {
  Construct
} from "constructs";
import {
  EcsCluster,
  EcsClusterCapacityProviders,
  EcsTaskDefinition,
} from "@cdktf/provider-aws/lib/ecs";
import {
  IamRole
} from "@cdktf/provider-aws/lib/iam";
import {
  CloudwatchLogGroup
} from "@cdktf/provider-aws/lib/cloudwatch";
import {
  Resource
} from "@cdktf/provider-null";
import {
  ITerraformDependable
} from "cdktf";
import { PgAdminImage } from "./ecr_image";


export class PgadminEcsCluster extends Resource {

  public cluster: EcsCluster;
  public task: EcsTaskDefinition;

  private region = "eu-central-1";

  constructor(scope: Construct, id: string, tags: {}, dependsOn: ITerraformDependable[]) {
    super(scope, id);

    // Build a Docker image and push it to ECR. Futher we will use it in ECS
    const pgadminImage = new PgAdminImage(this, "pgadmin-image-ecr", tags, dependsOn);

    // Basic cluster
    this.cluster = new EcsCluster(this, `ecs-${id}`, {
      name: id,
      tags,
    });

    new EcsClusterCapacityProviders(this, `capacity-providers-${id}`, {
      clusterName: this.cluster.name,
      capacityProviders: ["FARGATE"],
    });

    // Execution role uses by ECS in initial stage. Here it needs access to ECR to pull the image. Plus create some log events in case of any issues
    const executionRole = new IamRole(this, "execution-role", {
      name: "pgadmin-execution-role",
      tags,
      inlinePolicy: [{
        name: "allow-ecr-pull",
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{
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
          }, ],
        }),
      }, ],
      // this role shall only be used by an ECS task
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Sid: "",
          Principal: {
            Service: "ecs-tasks.amazonaws.com",
          },
        }, ],
      }),
    });
    // Task role is used during runtime, so here we define only policy related to logs pushing. Later, TaskDefinition will specify log group to use
    const taskRole = new IamRole(this, "task-role", {
      name: "pgadmin-task-role",
      tags,
      inlinePolicy: [{
        name: "allow-logs",
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{
            Effect: "Allow",
            Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
            Resource: "*",
          }, ],
        }),
      }, ],
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Sid: "",
          Principal: {
            Service: "ecs-tasks.amazonaws.com",
          },
        }, ],
      }),
    });

    // Creates a log group for the task
    const logGroup = new CloudwatchLogGroup(this, "loggroup", {
      name: `${this.cluster.name}/pgadmin`,
      retentionInDays: 30,
      tags,
    });

    // Creates a task that runs the docker container
    this.task = new EcsTaskDefinition(this, "pgadmin-task", {
      dependsOn: [pgadminImage.image],    // do not build the task untill the image is ready
      tags,
      cpu: "256",
      memory: "512",
      requiresCompatibilities: ["FARGATE", "EC2"],
      networkMode: "awsvpc",
      executionRoleArn: executionRole.arn,
      taskRoleArn: taskRole.arn,
      containerDefinitions: JSON.stringify([{
        name: "pgadmin",
        image: pgadminImage.imageTag,     // image we built in ecr_image
        cpu: 256,
        memory: 512,
        environment: Object.entries(pgadminImage.containerEnv).map(([name, value]) => ({
          name,
          value,
        })),
        essential: true,
        // Here we could expose 443 as well, but since ECS will be fronted by ALB, no need for extra security ALB<->ECS. ALB will accept only 443
        portMappings: [{
          containerPort: 80,
          hostPort: 80,
          protocol: "tcp"
        }],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroup.name,
            "awslogs-region": this.region,
            "awslogs-stream-prefix": "pgadmin",
          }
        }
      }]),
      family: "service"
    });

  }
}