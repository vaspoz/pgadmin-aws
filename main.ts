import {
  Construct
} from "constructs";
import {
  App,
  Fn,
  TerraformStack,
} from "cdktf";
import {
  AwsProvider
} from "@cdktf/provider-aws";
import {
  SecurityGroup
} from "@cdktf/provider-aws/lib/vpc";
import {
  NullProvider
} from "@cdktf/provider-null";
import {
  RandomProvider
} from "./.gen/providers/random";
import {
  PostgresDB
} from "./infra_resources/psql_db";
import {
  PgadminEcsCluster
} from "./infra_resources/ecs_cluster";
import {
  PgadminAlb
} from "./infra_resources/pgadmin_alb";
import {
  MainVpc
} from "./infra_resources/main_vpc";


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
    new NullProvider(this, "null");
    new RandomProvider(this, "random");

    const vpc = new MainVpc(this, 'PsqlVpc', tags, REGION).vpc;

    const cluster = new PgadminEcsCluster(this, "cluster", tags, REGION);
    const loadBalancer = new PgadminAlb(this, "loadbalancer", vpc, cluster.cluster, tags);
    const serviceSecurityGroup = new SecurityGroup(this, "service-security-group", {
      vpcId: Fn.tostring(vpc.vpcIdOutput),
      tags,
      ingress: [{
        protocol: "TCP",
        fromPort: 80,
        toPort: 80,
        cidrBlocks: ["0.0.0.0/0"]
      }],
      egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"],
      }]
    });

    new PostgresDB(this, "dockerintegration", vpc, serviceSecurityGroup, tags);

    const task = cluster.runDockerImage("pgadmin", 'dpage/pgadmin4', {
      PGADMIN_DEFAULT_EMAIL: "vaspoz@mail.ru",
      PGADMIN_DEFAULT_PASSWORD: 'admin'
    });

    loadBalancer.exposeService("pgadmin", task, serviceSecurityGroup, "/");

  }
}

const app = new App();
new MyStack(app, "pgadmin-aws");
app.synth();