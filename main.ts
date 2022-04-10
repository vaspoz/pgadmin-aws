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
import { LocalProvider } from "@cdktf/provider-local";


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
    new LocalProvider(this, "local");

    const vpc = new MainVpc(this, 'PsqlVpc', tags, REGION).vpc;

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

    // First, create PostgresDB
    new PostgresDB(this, "psql", vpc, serviceSecurityGroup, tags);

    const cluster = new PgadminEcsCluster(this, "cluster", tags, REGION);
    const loadBalancer = new PgadminAlb(this, "loadbalancer", vpc, cluster.cluster, tags);

    

    const task = cluster.runDockerImage("pgadmin", {
      PGADMIN_DEFAULT_EMAIL: "vaspoz@mail.ru",
      PGADMIN_DEFAULT_PASSWORD: "admin",
      PGADMIN_CONFIG_ENHANCED_COOKIE_PROTECTION: "False"
    });

    loadBalancer.exposeService("pgadmin", task, serviceSecurityGroup, "/");

  }
}

const app = new App();
new MyStack(app, "pgadmin-aws");
app.synth();