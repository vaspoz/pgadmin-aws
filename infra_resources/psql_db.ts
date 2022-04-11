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
  Password
} from "../.gen/providers/random";
import {
  File
} from "@cdktf/provider-local";
import path = require("path");


export class PostgresDB extends Resource {

  public db: Rds;
  public fileList: File[] = [];

  constructor(scope: Construct, id: string, vpc: Vpc, serviceSecurityGroup: SecurityGroup, tags: {}) {
    super(scope, id);

    new Password(this, "db-password", {
      length: 16,
      special: false,
    });

    const dbPort = 5432;

    const dbSecurityGroup = new SecurityGroup(this, "db-security-group", {
      vpcId: Fn.tostring(vpc.vpcIdOutput),
      ingress: [{
        fromPort: dbPort,
        toPort: dbPort,
        protocol: "TCP",
        securityGroups: [serviceSecurityGroup.id],
      }],
      tags
    });

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
      username: 'vaspoz',
      password: 'vaspozmailru',

      maintenanceWindow: "Mon:00:00-Mon:03:00",
      backupWindow: "03:00-06:00",

      // This is necessary due to a shortcoming in our token system to be adressed in
      // https://github.com/hashicorp/terraform-cdk/issues/651
      subnetIds: vpc.databaseSubnetsOutput as unknown as any,
      vpcSecurityGroupIds: [dbSecurityGroup.id],
      tags
    });

    const serversFile = new File(this, "psql-servers", {
      filename: path.resolve(__dirname, "./servers.json"),
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
    const pgpassFile = new File(this, "psql-passfile", {
      filename: path.resolve(__dirname, "./pgpassfile"),
      content: `${this.db.dbInstanceAddressOutput}:${this.db.port}:postgres:${this.db.username}:${this.db.password}`,
      // content: `*:*:*:${this.db.username}:${this.db.password}`,
      filePermission: "600"
    });

    this.fileList.push(serversFile, pgpassFile);

  }
}