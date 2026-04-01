import { defineFunction } from "@aws-amplify/backend";

export const webpayStartFn = defineFunction({
  name: "webpayStartV2",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
