import { defineFunction } from "@aws-amplify/backend";

export const webpayStatusFn = defineFunction({
  name: "webpayStatusV2",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
