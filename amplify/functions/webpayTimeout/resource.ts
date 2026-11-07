import { defineFunction } from "@aws-amplify/backend";

export const webpayTimeoutFn = defineFunction({
  name: "webpayTimeoutV2",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
