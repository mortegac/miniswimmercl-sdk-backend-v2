#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/stacks/auth-stack";
import { DatabaseStack } from "../lib/stacks/database-stack";
import { ApiStack } from "../lib/stacks/api-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const stage = app.node.tryGetContext("stage") ?? "dev";
const appName = "mytascensores-backoffice";

// ─── Auth Stack ───────────────────────────────────────────────────────────────
const authStack = new AuthStack(app, `${appName}-auth-${stage}`, {
  env,
  appName,
  stage,
  tags: { App: appName, Stage: stage, ManagedBy: "CDK" },
});

// ─── Database Stack ───────────────────────────────────────────────────────────
const databaseStack = new DatabaseStack(app, `${appName}-database-${stage}`, {
  env,
  appName,
  stage,
  tags: { App: appName, Stage: stage, ManagedBy: "CDK" },
});

// ─── API Stack ────────────────────────────────────────────────────────────────
const apiStack = new ApiStack(app, `${appName}-api-${stage}`, {
  env,
  appName,
  stage,
  userPool: authStack.userPool,
  table: databaseStack.table,
  tags: { App: appName, Stage: stage, ManagedBy: "CDK" },
});

apiStack.addDependency(authStack);
apiStack.addDependency(databaseStack);
