import {
    Construct
} from "constructs";
import {
    Resource
} from "@cdktf/provider-null";
import {
    DataAwsEcrAuthorizationToken,
    EcrRepository
} from "@cdktf/provider-aws/lib/ecr";
import * as path from "path";
import {
    ITerraformDependable,
    TerraformOutput
} from "cdktf";
import {
    StringResource
} from "../../.gen/providers/random";



export class PgAdminImage extends Resource {

    public readonly image: Resource;
    public readonly imageTag: string;
    // Default container env variables. Password will be generated later
    public containerEnv = {
        PGADMIN_DEFAULT_EMAIL: "default@email.eu",
        PGADMIN_DEFAULT_PASSWORD: "",
        PGADMIN_CONFIG_ENHANCED_COOKIE_PROTECTION: "False",
        PGPASSFILE: "/pgadmin4/pgpassfile"
    };

    constructor(scope: Construct, id: string, tags: {}, pgFiles: ITerraformDependable[]) {

        super(scope, id);

        // Create a repository
        const repo = new EcrRepository(this, "ecr", {
            name: `${id}-repo`,
            tags
        });

        // get the authorization for ECR
        const auth = new DataAwsEcrAuthorizationToken(this, "auth", {
            dependsOn: [repo],
            registryId: repo.registryId
        });

        // Generate password for PgAdmin4 user
        const strpass = new StringResource(this, 'strpass', {
            length: 16
        });
        this.containerEnv.PGADMIN_DEFAULT_PASSWORD = strpass.result;

        // Create an image tag. This is a specific format, accepted by ECR
        this.imageTag = `${repo.repositoryUrl}:1.0.0`;
        
        // dependsOn - that's a list of files needed to build an image (servers.json and pgpassfile). Hence, we ask Terraform to wait until they're ready
        this.image = new Resource(this, "pgadmin-image", {
            dependsOn: pgFiles
        });
        /**
         *  Here we manually build an image:
         *      first, just in case, logout from current docker repo connection
         *      next, login to just created above ECR
         *      next, build the image
         *      last - push it!
         */
        this.image.addOverride("provisioner.local-exec.command",
            `
          sudo docker logout &&
          sudo docker login -u ${auth.userName} -p ${auth.password} ${auth.proxyEndpoint} &&
          sudo docker build -t ${this.imageTag} ${path.resolve(__dirname)} &&
          sudo docker push ${this.imageTag}
        `
        );

        // Output username and password to login to PgAdmin4
        new TerraformOutput(this, 'pgadminpass', {
            value: strpass.id,
            sensitive: false,
        });
        new TerraformOutput(this, 'pgadminuser', {
            value: this.containerEnv.PGADMIN_DEFAULT_EMAIL
        });
    }
}