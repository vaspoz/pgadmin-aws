import {
  Construct
} from "constructs";
import {
  App,
  TerraformStack,
} from "cdktf";
import {
  PostgresDB
} from "./infra_resources/psql_db";
import {
  PgadminEcsCluster
} from "./infra_resources/ecs/ecs_cluster";
import {
  PgadminAlb
} from "./infra_resources/pgadmin_alb";
import {
  MainVpc
} from "./infra_resources/main_vpc";
import { defineProviders } from "./infra_resources/providers";

const tags = {
  iac: "terraform",
  tool: "cdktf",
  owner: "basilp"
};

/**
 * PgadminStack defines the main stack in our application.
 * inside, it configures next high level constructs:
 *    1. Terraform Providers:
 *      a. aws
 *      b. null
 *      c. random
 *      d. local
 *      e. tls
 *    2. VPC:
 *      a. 3 public subnets (for application load balancer)
 *      b. 3 private subnets (for ECS tasks)
 *      c. another 3 private subnets (for RDS backed by PostgreSQL)
 *      d. Internet gateway
 *      e. NAT
 *      f. security groups, route tables etc..
 *    3. Postgres DB (more description in a respective module)
 *    4. ECS cluster (more description in a respective module)
 *    5. ALB (more description in a respective module)
 */
class PgadminStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);

    // #1
    defineProviders(this);

    // #2
    const vpc = new MainVpc(this, 'PsqlVpc', tags).vpc;

    // #3
    const db = new PostgresDB(this, "psql", vpc, tags);

    // #4
    const pgadminCluster = new PgadminEcsCluster(this, "cluster", tags, db.fileList);

    // #5
    const loadBalancer = new PgadminAlb(this, "loadbalancer", vpc, pgadminCluster, tags);

    // Last - setup the DB security group to accept connections only from ECS tasks
    db.setSecurityGroup(loadBalancer.pgadminSecurityGroup);
    
  }
}

const app = new App();
new PgadminStack(app, "pgadmin-aws");
app.synth();