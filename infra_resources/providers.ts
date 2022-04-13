import { AwsProvider } from "@cdktf/provider-aws";
import { NullProvider } from "@cdktf/provider-null";
import { RandomProvider } from "../.gen/providers/random";
import { LocalProvider } from "@cdktf/provider-local";
import { Construct } from "constructs";
import { TlsProvider } from "@cdktf/provider-tls";
import { TimeProvider } from "../.gen/providers/time";

const REGION = process.env["REGION"] || "eu-central-1";
const PROFILE = process.env["AWSPROFILE"] || "default";

console.log(`#  Terraform is using [${REGION}] region`);
console.log(`#  Terraform is using [${PROFILE}] AWS CLI profile`);

export const defineProviders = (that: Construct) => {

    new AwsProvider(that, "aws", {
        region: REGION,
        profile: PROFILE
      });
      new NullProvider(that, "null");     // used to create a custom Resources, like docker image
      new RandomProvider(that, "random"); // used to generate usernames and passwords
      new LocalProvider(that, "local");   // used to create files needed for docker image
      new TlsProvider(that, "tls");       // used to create a certificate
      new TimeProvider(that, "time");     // used to introduce a sleep time at the end of the process to allow tagret groups get healthy state
      
}