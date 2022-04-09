import { Construct } from "constructs";
import {
  App,
  Fn,
  // TerraformAsset,
  // TerraformOutput,
  TerraformStack,
} from "cdktf";
// import * as path from "path";
// import { sync as glob } from "glob";
// import { lookup as mime } from "mime-types";
import { AwsProvider } from "@cdktf/provider-aws";
// import { CloudfrontDistribution } from "@cdktf/provider-aws/lib/cloudfront";
// import {
//   DataAwsEcrAuthorizationToken,
//   EcrRepository,
// } from "@cdktf/provider-aws/lib/ecr";
import {
  EcsCluster,
  EcsClusterCapacityProviders,
  EcsService,
  EcsTaskDefinition,
} from "@cdktf/provider-aws/lib/ecs";
import { IamRole } from "@cdktf/provider-aws/lib/iam";
import {
  Lb,
  LbListener,
  LbListenerRule,
  LbTargetGroup,
} from "@cdktf/provider-aws/lib/elb";
import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch";
import { SecurityGroup } from "@cdktf/provider-aws/lib/vpc";
import { NullProvider, Resource } from "@cdktf/provider-null";
import { Vpc } from "./.gen/modules/terraform-aws-modules/aws/vpc";
import { Rds } from "./.gen/modules/terraform-aws-modules/aws/rds";
import { RandomProvider, Password } from "./.gen/providers/random";

const REGION = "eu-central-1";

const tags = {
  iac: "terraform",
  tool: "cdktf",
  owner: "basilp"
};

class PostgresDB extends Resource {
  public instance: Rds;

  constructor(
    scope: Construct,
    name: string,
    vpc: Vpc,
    serviceSecurityGroup: SecurityGroup
  ) {
    super(scope, name);

    new Password(this, `db-password`, {
      length: 16,
      special: false,
    });

    const dbPort = 5432;

    const dbSecurityGroup = new SecurityGroup(this, "db-security-group", {
      vpcId: Fn.tostring(vpc.vpcIdOutput),
      ingress: [
        {
          fromPort: dbPort,
          toPort: dbPort,
          protocol: "TCP",
          securityGroups: [serviceSecurityGroup.id],
        },
      ],
      tags,
    });

    // Using this module: https://registry.terraform.io/modules/terraform-aws-modules/rds/aws/latest
    const db = new Rds(this, "db", {
      identifier: `${name}-db`,

      engine: "postgres",
      engineVersion: "14.1",
      family: "postgres14",
      majorEngineVersion: "14",
      instanceClass: "db.t3.micro",
      allocatedStorage: "5",

      createDbOptionGroup: false,
      createDbParameterGroup: false,
      applyImmediately: true,

      name,
      port: String(dbPort),
      username: 'vaspoz',
      password: 'vaspozmailru',

      maintenanceWindow: "Mon:00:00-Mon:03:00",
      backupWindow: "03:00-06:00",

      // This is necessary due to a shortcoming in our token system to be adressed in
      // https://github.com/hashicorp/terraform-cdk/issues/651
      subnetIds: vpc.databaseSubnetsOutput as unknown as any,
      vpcSecurityGroupIds: [dbSecurityGroup.id],
      tags,
    });

    this.instance = db;
  }
}

class Cluster extends Resource {
  public cluster: EcsCluster;
  constructor(scope: Construct, clusterName: string) {
    super(scope, clusterName);

    const cluster = new EcsCluster(this, `ecs-${clusterName}`, {
      name: clusterName,
      tags,
    });

    new EcsClusterCapacityProviders(this, `capacity-providers-${clusterName}`, {
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

class LoadBalancer extends Resource {
  lb: Lb;
  lbl: LbListener;
  vpc: Vpc;
  cluster: EcsCluster;

  constructor(scope: Construct, name: string, vpc: Vpc, cluster: EcsCluster) {
    super(scope, name);
    this.vpc = vpc;
    this.cluster = cluster;

    const lbSecurityGroup = new SecurityGroup(this, `lb-security-group`, {
      vpcId: Fn.tostring(vpc.vpcIdOutput),
      tags,
      ingress: [
        // allow HTTP traffic from everywhere
        {
          protocol: "TCP",
          fromPort: 80,
          toPort: 80,
          cidrBlocks: ["0.0.0.0/0"],
          ipv6CidrBlocks: ["::/0"],
        },
      ],
      egress: [
        // allow all traffic to every destination
        {
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          cidrBlocks: ["0.0.0.0/0"],
          ipv6CidrBlocks: ["::/0"],
        },
      ],
    });
    this.lb = new Lb(this, `lb`, {
      name,
      tags,
      // we want this to be our public load balancer so that users can access it
      internal: false,
      loadBalancerType: "application",
      securityGroups: [lbSecurityGroup.id],
    });

    // This is necessary due to a shortcoming in our token system to be adressed in
    // https://github.com/hashicorp/terraform-cdk/issues/651
    this.lb.addOverride("subnets", vpc.publicSubnetsOutput);

    this.lbl = new LbListener(this, `lb-listener`, {
      loadBalancerArn: this.lb.arn,
      port: 80,
      protocol: "HTTP",
      tags,
      defaultAction: [
        // We define a fixed 404 message, just in case
        {
          type: "fixed-response",
          fixedResponse: {
            contentType: "text/plain",
            statusCode: "404",
            messageBody: "Could not find the resource you are looking for",
          },
        },
      ],
    });
  }

  exposeService(
    name: string,
    task: EcsTaskDefinition,
    serviceSecurityGroup: SecurityGroup,
    path: string
  ) {
    // Define Load Balancer target group with a health check on /ready
    const targetGroup = new LbTargetGroup(this, `target-group`, {
      dependsOn: [this.lbl],
      tags,
      name: `${name}-target-group`,
      port: 80,
      protocol: "HTTP",
      targetType: "ip",
      vpcId: Fn.tostring(this.vpc.vpcIdOutput),
      healthCheck: {
        enabled: true,
        path: "/",
        timeout: 60,
        interval: 120,
        matcher: "302"
      },
      slowStart: 30
    });

    // Makes the listener forward requests from subpath to the target group
    new LbListenerRule(this, `rule`, {
      listenerArn: this.lbl.arn,
      priority: 100,
      tags,
      action: [
        {
          type: "forward",
          targetGroupArn: targetGroup.arn,
        },
      ],

      condition: [
        {
          pathPattern: { values: [`${path}*`] },
        },
      ],
    });

    // Ensure the task is running and wired to the target group, within the right security group
    new EcsService(this, `service`, {
      dependsOn: [this.lbl],
      waitForSteadyState: true,
      tags,
      name,
      launchType: "FARGATE",
      cluster: this.cluster.id,
      desiredCount: 1,
      taskDefinition: task.arn,
      networkConfiguration: {
        subnets: Fn.tolist(this.vpc.privateSubnetsOutput),
        assignPublicIp: true,
        securityGroups: [serviceSecurityGroup.id],
      },
      loadBalancer: [
        {
          containerPort: 80,
          containerName: name,
          targetGroupArn: targetGroup.arn,
        },
      ],
    });
  }
}

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);

    new AwsProvider(this, "aws", {
      region: REGION,
      profile: "cdk"
    });
    new NullProvider(this, "null", {});
    new RandomProvider(this, "random", {});

    const vpc = new Vpc(this, "vpc", {
      name,
      tags,
      cidr: "10.0.0.0/16",
      // We want to run on three availability zones
      azs: ["a", "b", "c"].map((i) => `${REGION}${i}`),
      // We need three CIDR blocks as we have three availability zones
      privateSubnets: ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"],
      publicSubnets: ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"],
      databaseSubnets: ["10.0.201.0/24", "10.0.202.0/24", "10.0.203.0/24"],
      createDatabaseSubnetGroup: true,
      enableNatGateway: true,
      // Using a single NAT Gateway will save us some money, coming with the cost of less redundancy
      singleNatGateway: true,
    });

    const cluster = new Cluster(this, "cluster");
    const loadBalancer = new LoadBalancer(
      this,
      "loadbalancer",
      vpc,
      cluster.cluster
    );
    const serviceSecurityGroup = new SecurityGroup(
      this,
      `service-security-group`,
      {
        vpcId: Fn.tostring(vpc.vpcIdOutput),
        tags,
        ingress: [
          // only allow incoming traffic from our load balancer
          {
            protocol: "TCP",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"]
          },
        ],
        egress: [
          // allow all outgoing traffic
          {
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
            ipv6CidrBlocks: ["::/0"],
          },
        ],
      }
    );

    new PostgresDB(
      this,
      "dockerintegration",
      vpc,
      serviceSecurityGroup
    );


    const task = cluster.runDockerImage("backend", 'dpage/pgadmin4', {
      PGADMIN_DEFAULT_EMAIL: "vaspoz@mail.ru",
      PGADMIN_DEFAULT_PASSWORD: 'admin'
    });
    loadBalancer.exposeService(
      "backend",
      task,
      serviceSecurityGroup,
      "/"
    );

  }
}

const app = new App();
new MyStack(app, "pgadmin-aws");
app.synth();