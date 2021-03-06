import {
    Construct
} from "constructs";
import {
    Vpc
} from "../.gen/modules/terraform-aws-modules/aws/vpc";
import {
    Resource
} from "@cdktf/provider-null";


const REGION = process.env["REGION"] || "eu-central-1";

export class MainVpc extends Resource {

    public vpc: Vpc;

    constructor(scope: Construct, id: string, tags: {}) {
        super(scope, id);

        this.vpc = new Vpc(this, "vpc", {
            name: id,
            tags,
            cidr: "10.0.0.0/16",
            azs: ["a", "b", "c"].map((i) => `${REGION}${i}`),
            publicSubnets: ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"],    // ALB
            privateSubnets: ["10.0.21.0/24", "10.0.22.0/24", "10.0.23.0/24"],   // ECS
            databaseSubnets: ["10.0.51.0/24", "10.0.52.0/24", "10.0.53.0/24"],  // Postgres
            createDatabaseSubnetGroup: true,                                    // Automatically creates db subnet group for RDS stack
            enableNatGateway: true,                                             
            singleNatGateway: true,                                             // To save some money
        });

    }
}