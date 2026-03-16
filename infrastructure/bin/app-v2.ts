#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AuthStackV2 } from "../lib/stacks/auth-stack-v2";
import { DatabaseStackV2 } from "../lib/stacks/database-stack-v2";
import { ApiStackV2 } from "../lib/stacks/api-stack-v2";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const stage = app.node.tryGetContext("stage") ?? "dev";
const appName = "miniswimmer-backofficev2";

// ─── Auth Stack V2 ────────────────────────────────────────────────────────────
const authStack = new AuthStackV2(app, `${appName}-auth-${stage}`, {
  env,
  appName,
  stage,
  tags: { App: appName, Stage: stage, ManagedBy: "CDK", Version: "V2" },
});

// ─── Database Stack V2 ────────────────────────────────────────────────────────
const databaseStack = new DatabaseStackV2(app, `${appName}-database-${stage}`, {
  env,
  appName,
  stage,
  tags: { App: appName, Stage: stage, ManagedBy: "CDK", Version: "V2" },
});

// ─── API Stack V2 ─────────────────────────────────────────────────────────────
const apiStack = new ApiStackV2(app, `${appName}-api-${stage}`, {
  env,
  appName,
  stage,
  userPool: authStack.userPool,
  table: databaseStack.table,
  tags: { App: appName, Stage: stage, ManagedBy: "CDK", Version: "V2" },
});

apiStack.addDependency(authStack);
apiStack.addDependency(databaseStack);
