import { defineFunction } from "@aws-amplify/backend";

export const webpayCommitFn = defineFunction({
  name: "webpayCommitV2",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
