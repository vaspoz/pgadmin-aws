import {
  Construct
} from "constructs";
import {
  Fn
} from "cdktf";
import {
  SecurityGroup
} from "@cdktf/provider-aws/lib/vpc";
import {
  Resource
} from "@cdktf/provider-null";
import {
  Vpc
} from "../.gen/modules/terraform-aws-modules/aws/vpc";
import {
  Rds
} from "../.gen/modules/terraform-aws-modules/aws/rds";
import {
  StringResource
} from "../.gen/providers/random";
import {
  File
} from "@cdktf/provider-local";
import path = require("path");


export class PostgresDB extends Resource {

  public db: Rds;
  public fileList: File[] = [];     // We have to expose those files to allow external contstructs (Image, in that case, see exs_cluster.ts) to wait until they actually persisted in filesystem

  private readonly vpc: Vpc;

  constructor(scope: Construct, id: string, vpc: Vpc, tags: {}) {
    super(scope, id);

    const dbUsername = new StringResource(this, "db-username", {
      length: 8,
      special: false,
      number: false
    });
    const dbPassword = new StringResource(this, "db-password", {
      length: 12
    });

    const dbPort = 6543;
    this.vpc = vpc;

    this.db = new Rds(this, "db", {
      identifier: `${id}-db`,
      engine: "postgres",
      engineVersion: "14.1",
      family: "postgres14",
      majorEngineVersion: "14",
      instanceClass: "db.t3.micro",
      allocatedStorage: "5",
      createDbOptionGroup: false,
      createDbParameterGroup: false,
      applyImmediately: true,
      name: id,
      port: String(dbPort),
      username: dbUsername.result,
      password: dbPassword.result,
      maintenanceWindow: "Mon:00:00-Mon:03:00",
      backupWindow: "03:00-06:00",
      subnetIds: vpc.databaseSubnetsOutput as unknown as any,
      tags
    });

    // This file will help PgAdmin to automatically setup the server configuration
    const serversFile = new File(this, "psql-servers", {
      filename: path.resolve(__dirname, "./ecs/servers.json"),
      content: JSON.stringify({
        "Servers": {
          "1": {
            "Name": "postgresql",
            "Group": "Servers",
            "Host": this.db.dbInstanceAddressOutput,
            "Port": parseInt(this.db.port),
            "MaintenanceDB": "postgres",
            "Username": this.db.username,
            "SSLMode": "prefer",
            "PassFile": "/pgpassfile"
          }
        }
      })
    });

    // This file will setup credentials for above mentioned connection. Both files will be used during docker build stage (see ecs_cluster)
    const pgpassFile = new File(this, "psql-passfile", {
      filename: path.resolve(__dirname, "./ecs/pgpassfile"),
      content: `${this.db.dbInstanceAddressOutput}:${this.db.port}:postgres:${this.db.username}:${this.db.password}`,
      filePermission: "600"
    });

    this.fileList.push(serversFile, pgpassFile);

  }

  // We need an extra function in this class, to make use of it on a later stages ,
  // because the db secutiry group should allow connections only from ECS cluster, which will be defined later
  public setSecurityGroup = (ingressSecGroup: SecurityGroup) => {
    const dbSecurityGroup = new SecurityGroup(this, "db-security-group", {
      vpcId: Fn.tostring(this.vpc.vpcIdOutput),
      ingress: [{
        fromPort: parseInt(this.db.port),
        toPort: parseInt(this.db.port),
        protocol: "TCP",
        securityGroups: [ingressSecGroup.id],
      }]
    });

    this.db.vpcSecurityGroupIds = [dbSecurityGroup.id];

  }
}