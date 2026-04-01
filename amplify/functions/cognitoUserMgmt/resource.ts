import { defineFunction } from "@aws-amplify/backend";

export const cognitoUserMgmtFn = defineFunction({
  name: "cognitoUserMgmt",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 15,
  resourceGroupName: "data",
});
