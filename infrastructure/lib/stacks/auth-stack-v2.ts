import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

interface AuthStackV2Props extends cdk.StackProps {
  appName: string;
  stage: string;
}

export class AuthStackV2 extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackV2Props) {
    super(scope, id, props);
    const { appName, stage } = props;

    // ─── User Pool ────────────────────────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${appName}-${stage}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy:
        stage === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // ─── User Pool Groups ─────────────────────────────────────────────────────
    const groups: Array<{ name: string; description: string; precedence: number }> = [
      { name: "ADMIN", description: "Administradores del sistema", precedence: 1 },
      { name: "TECHNICIAN", description: "Técnicos de mantenimiento", precedence: 2 },
      { name: "SALES", description: "Equipo de ventas", precedence: 3 },
      { name: "VIEWER", description: "Solo lectura", precedence: 4 },
    ];

    groups.forEach(({ name, description, precedence }) => {
      new cognito.CfnUserPoolGroup(this, `Group${name}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: name,
        description,
        precedence,
      });
    });

    // ─── App Client ───────────────────────────────────────────────────────────
    this.userPoolClient = this.userPool.addClient("BackofficeClient", {
      userPoolClientName: `${appName}-client-${stage}`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true,
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // ─── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      exportName: `${appName}-${stage}-UserPoolId`,
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${appName}-${stage}-UserPoolClientId`,
    });
  }
}
