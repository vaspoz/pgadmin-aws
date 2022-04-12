import {
  Construct
} from "constructs";
import {
  Fn,
  TerraformOutput,
} from "cdktf";
import {
  EcsService
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
import {
  PgadminEcsCluster
} from "./ecs/ecs_cluster";
import {
  PrivateKey,
  SelfSignedCert,
  SelfSignedCertSubject
} from "@cdktf/provider-tls";
import {
  acm
} from "../.gen/providers/aws";
import {
  Sleep
} from "../.gen/providers/time";


export class PgadminAlb extends Resource {

  public readonly pgadminSecurityGroup: SecurityGroup;
  public readonly alb: Lb;

  constructor(scope: Construct, id: string, vpc: Vpc, pgadminCluster: PgadminEcsCluster, tags: {}) {
    super(scope, id);

    // Generate locally a private pem key
    const privateKey = new PrivateKey(this, 'pemfile', {
      algorithm: "RSA"
    });

    // Generate self-signed (!) certificate
    const selfcert = new SelfSignedCert(this, 'selfcert', {
      keyAlgorithm: "RSA",
      privateKeyPem: privateKey.privateKeyPem,
      allowedUses: ["key_encipherment", "digital_signature", "server_auth"],
      validityPeriodHours: 12,
      subject: [{
          commonName: "example.com",
          organization: "ACME Examples, Inc"
        } as SelfSignedCertSubject
      ]
    });

    // Upload to ACM generated above self-signed cert
    const acmCert = new acm.AcmCertificate(this, 'acmcert', {
      privateKey: privateKey.privateKeyPem,
      certificateBody: selfcert.certPem
    });

    // ALB should allow all incoming connections on ports 80 and 443 (80 gonna be rerouted to 443)
    const lbSecurityGroup = new SecurityGroup(this, "lb-security-group", {
      vpcId: Fn.tostring(vpc.vpcIdOutput),
      tags,
      ingress: [{
        protocol: "TCP",
        fromPort: 443,
        toPort: 443,
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"]
      }, {
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
    // That SG is used by pgadmin tasks - to only accept connections from ALB
    this.pgadminSecurityGroup = new SecurityGroup(this, "service-security-group", {
      vpcId: Fn.tostring(vpc.vpcIdOutput),
      tags,
      ingress: [{
        protocol: "TCP",
        fromPort: 80,
        toPort: 80,
        securityGroups: [lbSecurityGroup.id]
      }],
      egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"],
      }]
    });

    // The ALB itself
    this.alb = new Lb(this, "lb", {
      name: id,
      tags,
      // we want this to be our public load balancer so that users can access it
      internal: false,
      loadBalancerType: "application",
      securityGroups: [lbSecurityGroup.id]
    });
    // This is necessary because cdktf in not yet ready to properly map subnets, hence - custom override
    this.alb.addOverride("subnets", vpc.publicSubnetsOutput);

    // Create a listener on port 80 and redirect it to 443
    new LbListener(this, "lb-listener", {
      loadBalancerArn: this.alb.arn,
      port: 80,
      protocol: "HTTP",
      tags,
      defaultAction: [{
        type: "redirect",
        redirect: {
          port: "443",
          protocol: "HTTPS",
          statusCode: "HTTP_301"
        }
      }]
    });

    // 443 listener with a default action 404. A rule for that listener will be specified below
    const lbl = new LbListener(this, "lb-listener-tls", {
      loadBalancerArn: this.alb.arn,
      port: 443,
      protocol: "HTTPS",
      certificateArn: acmCert.arn,
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

    // Define Load Balancer target group with a health check on /ready
    const targetGroup = new LbTargetGroup(this, "target-group", {
      dependsOn: [lbl],
      tags,
      name: "pgadmin-target-group",
      port: 80,
      protocol: "HTTP",
      targetType: "ip",
      vpcId: Fn.tostring(vpc.vpcIdOutput),
      stickiness: {
        type: "lb_cookie"
      },
      healthCheck: {
        enabled: true,
        path: "/",
        timeout: 60,
        interval: 120,
        matcher: "302"
      },
      slowStart: 30
    });

    // Makes the 443 listener forward requests from subpath to the target group
    new LbListenerRule(this, "simple-rule", {
      listenerArn: lbl.arn,
      priority: 100,
      tags,
      action: [{
        type: "forward",
        targetGroupArn: targetGroup.arn,
      }],
      condition: [{
        pathPattern: {
          values: ["/*"]
        }
      }]
    });

    // Ensure the ECS task is running and wired to the target group, within the right security group
    const ecsService = new EcsService(this, "service", {
      waitForSteadyState: true,
      tags,
      name: "pgadmin",
      launchType: "FARGATE",
      cluster: pgadminCluster.cluster.id,
      desiredCount: 3,
      taskDefinition: pgadminCluster.task.arn,
      networkConfiguration: {
        subnets: Fn.tolist(vpc.privateSubnetsOutput),
        assignPublicIp: true,
        securityGroups: [this.pgadminSecurityGroup.id],
      },
      loadBalancer: [{
        containerPort: 80,
        containerName: "pgadmin",
        targetGroupArn: targetGroup.arn,
      }]
    });
    
    // [Important] Sleep delay is needed here because as it is, the ALB will be ready BEFORE any task become HEALTHY. Leading to 502 Bad Gateway exception.
    // To avoid that confusion, we're waiting for 2 minutes (after the EcsTask is in ready state), to allow nodes get to healthy state
    new Sleep(this, "sleep-delay", {
      dependsOn: [ecsService],
      createDuration: "2m"
    });


    new TerraformOutput(this, "AlbUrl", {
      value: this.alb.dnsName
    });
  
  }
}