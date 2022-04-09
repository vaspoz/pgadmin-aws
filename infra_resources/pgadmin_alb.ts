import { Construct } from "constructs";
import {
  Fn,
} from "cdktf";
import {
  EcsCluster,
  EcsService,
  EcsTaskDefinition,
} from "@cdktf/provider-aws/lib/ecs";
import {
  Lb,
  LbListener,
  LbListenerRule,
  LbTargetGroup,
} from "@cdktf/provider-aws/lib/elb";
import { SecurityGroup } from "@cdktf/provider-aws/lib/vpc";
import { Resource } from "@cdktf/provider-null";
import { Vpc } from "../.gen/modules/terraform-aws-modules/aws/vpc";
import { Sleep } from "../.gen/providers/time";

const tags = {
  iac: "terraform",
  tool: "cdktf",
  owner: "basilp"
};

export class PgadminAlb extends Resource {
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

    const sleep3m = new Sleep(this, 'sleep30', {
      createDuration: '3m'
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
      dependsOn: [this.lbl, sleep3m],
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