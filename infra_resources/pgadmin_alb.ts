import {
  Construct
} from "constructs";
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
import {
  SecurityGroup
} from "@cdktf/provider-aws/lib/vpc";
import {
  Resource
} from "@cdktf/provider-null";
import {
  Vpc
} from "../.gen/modules/terraform-aws-modules/aws/vpc";


export class PgadminAlb extends Resource {

  private readonly lb: Lb;
  private readonly lbl: LbListener;
  private readonly vpc: Vpc;
  private readonly cluster: EcsCluster;
  private readonly tags: {};

  constructor(scope: Construct, id: string, vpc: Vpc, cluster: EcsCluster, tags: {}) {
    super(scope, id);
    this.vpc = vpc;
    this.cluster = cluster;
    this.tags = tags;

    const lbSecurityGroup = new SecurityGroup(this, "lb-security-group", {
      vpcId: Fn.tostring(vpc.vpcIdOutput),
      tags,
      ingress: [{
        protocol: "TCP",
        fromPort: 80,
        toPort: 80,
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"]
      }],
      egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"]
      }]
    });
    this.lb = new Lb(this, "lb", {
      name: id,
      tags,
      // we want this to be our public load balancer so that users can access it
      internal: false,
      loadBalancerType: "application",
      securityGroups: [lbSecurityGroup.id],
      // subnets: [vpc.publicSubnetsOutput]
    });

    // This is necessary due to a shortcoming in our token system to be adressed in
    this.lb.addOverride("subnets", vpc.publicSubnetsOutput);

    this.lbl = new LbListener(this, "lb-listener", {
      loadBalancerArn: this.lb.arn,
      port: 80,
      protocol: "HTTP",
      tags,
      defaultAction: [{
        type: "fixed-response",
        fixedResponse: {
          contentType: "text/plain",
          statusCode: "404",
          messageBody: "Not found",
        }
      }]
    });
  }

  exposeService(serviceName: string, task: EcsTaskDefinition, serviceSecurityGroup: SecurityGroup, path: string) {
    // Define Load Balancer target group with a health check on /ready
    const targetGroup = new LbTargetGroup(this, "target-group", {
      dependsOn: [this.lbl],
      tags: this.tags,
      name: `${serviceName}-target-group`,
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
    new LbListenerRule(this, "simple-rule", {
      listenerArn: this.lbl.arn,
      priority: 100,
      tags: this.tags,
      action: [{
        type: "forward",
        targetGroupArn: targetGroup.arn,
      }],
      condition: [{
        pathPattern: {
          values: [`${path}*`]
        }
      }]
    });

    // Ensure the task is running and wired to the target group, within the right security group
    new EcsService(this, "service", {
      dependsOn: [this.lbl],
      waitForSteadyState: true,
      tags: this.tags,
      name: serviceName,
      launchType: "FARGATE",
      cluster: this.cluster.id,
      desiredCount: 1,
      taskDefinition: task.arn,
      networkConfiguration: {
        subnets: Fn.tolist(this.vpc.privateSubnetsOutput),
        assignPublicIp: true,
        securityGroups: [serviceSecurityGroup.id],
      },
      loadBalancer: [{
        containerPort: 80,
        containerName: serviceName,
        targetGroupArn: targetGroup.arn,
      }]
    });
  }
}