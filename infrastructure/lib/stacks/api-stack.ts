import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

interface ApiStackProps extends cdk.StackProps {
  appName: string;
  stage: string;
  userPool: cognito.UserPool;
  table: dynamodb.Table;
}

export class ApiStack extends cdk.Stack {
  public readonly api: appsync.GraphqlApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { appName, stage, userPool, table } = props;

    // ─── Lambda: Resolver ─────────────────────────────────────────────────────
    const resolverLambda = new lambda.Function(this, "ResolverFunction", {
      functionName: `${appName}-resolver-${stage}`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../../backend/dist")
      ),
      environment: {
        TABLE_NAME: table.tableName,
        STAGE: stage,
        POWERTOOLS_SERVICE_NAME: appName,
        LOG_LEVEL: stage === "prod" ? "WARN" : "DEBUG",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logRetention: logs.RetentionDays.ONE_MONTH,
      tracing: lambda.Tracing.ACTIVE,
    });

    table.grantReadWriteData(resolverLambda);

    // ─── Cognito: Admin permissions ───────────────────────────────────────────
    resolverLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:AdminDisableUser",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:ListUsers",
        ],
        resources: [userPool.userPoolArn],
      })
    );

    // ─── AppSync API ──────────────────────────────────────────────────────────
    this.api = new appsync.GraphqlApi(this, "BackofficeApi", {
      name: `${appName}-${stage}`,
      schema: appsync.SchemaFile.fromAsset(
        path.join(__dirname, "../../../schema/schema.graphql")
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
        additionalAuthorizationModes: [
          { authorizationType: appsync.AuthorizationType.IAM },
        ],
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ALL,
        retention: logs.RetentionDays.ONE_MONTH,
      },
      xrayEnabled: true,
    });

    // ─── Data Source ──────────────────────────────────────────────────────────
    const lambdaDs = this.api.addLambdaDataSource(
      "LambdaDataSource",
      resolverLambda
    );

    // ─── Resolvers ────────────────────────────────────────────────────────────
    const resolvers: Array<{ typeName: string; fieldName: string }> = [
      // Queries
      { typeName: "Query", fieldName: "getCustomer" },
      { typeName: "Query", fieldName: "listCustomers" },
      { typeName: "Query", fieldName: "searchCustomers" },
      { typeName: "Query", fieldName: "getUser" },
      { typeName: "Query", fieldName: "getCurrentUser" },
      { typeName: "Query", fieldName: "listUsers" },
      { typeName: "Query", fieldName: "getWebform" },
      { typeName: "Query", fieldName: "listWebforms" },
      { typeName: "Query", fieldName: "listWebformsByCustomer" },
      // Mutations
      { typeName: "Mutation", fieldName: "createCustomer" },
      { typeName: "Mutation", fieldName: "updateCustomer" },
      { typeName: "Mutation", fieldName: "deleteCustomer" },
      { typeName: "Mutation", fieldName: "createUser" },
      { typeName: "Mutation", fieldName: "updateUser" },
      { typeName: "Mutation", fieldName: "deactivateUser" },
      { typeName: "Mutation", fieldName: "createWebform" },
      { typeName: "Mutation", fieldName: "updateWebform" },
      { typeName: "Mutation", fieldName: "assignWebform" },
    ];

    resolvers.forEach(({ typeName, fieldName }) => {
      lambdaDs.createResolver(`${typeName}${fieldName}Resolver`, {
        typeName,
        fieldName,
      });
    });

    // ─── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "GraphqlApiUrl", {
      value: this.api.graphqlUrl,
      exportName: `${appName}-${stage}-GraphqlApiUrl`,
    });

    new cdk.CfnOutput(this, "GraphqlApiId", {
      value: this.api.apiId,
      exportName: `${appName}-${stage}-GraphqlApiId`,
    });
  }
}
