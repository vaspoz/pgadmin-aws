import { Construct } from "constructs";
import {
  App,
  Fn,
  TerraformStack,
} from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws";
import { SecurityGroup } from "@cdktf/provider-aws/lib/vpc";
import { NullProvider } from "@cdktf/provider-null";
import { Vpc } from "./.gen/modules/terraform-aws-modules/aws/vpc";
import { RandomProvider } from "./.gen/providers/random";
import { PostgresDB } from "./infra_resources/psql_db";
import { PgadminEcsCluster } from "./infra_resources/ecs_cluster";
import { PgadminAlb } from "./infra_resources/pgadmin_alb";
import { TimeProvider } from "./.gen/providers/time";

const REGION = "eu-central-1";

const tags = {
  iac: "terraform",
  tool: "cdktf",
  owner: "basilp"
};

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);

    new AwsProvider(this, "aws", {
      region: REGION,
      profile: "cdk"
    });
    new NullProvider(this, "null", {});
    new RandomProvider(this, "random", {});
    new TimeProvider(this, "time", {});

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

    const cluster = new PgadminEcsCluster(this, "cluster");
    const loadBalancer = new PgadminAlb(
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