import { AwsProvider } from "@cdktf/provider-aws";
import { NullProvider } from "@cdktf/provider-null";
import { RandomProvider } from "../.gen/providers/random";
import { LocalProvider } from "@cdktf/provider-local";
import { Construct } from "constructs";
import { TlsProvider } from "@cdktf/provider-tls";
import { TimeProvider } from "../.gen/providers/time";

const REGION = "eu-central-1";
const PROFILE = "cdk";

export const defineProviders = (that: Construct) => {

    new AwsProvider(that, "aws", {
        region: REGION,
        profile: PROFILE
      });
      new NullProvider(that, "null");
      new RandomProvider(that, "random");
      new LocalProvider(that, "local");
      new TlsProvider(that, "tls");
      new TimeProvider(that, "time");
      
}