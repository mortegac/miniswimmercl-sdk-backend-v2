import { defineFunction } from "@aws-amplify/backend";

export const gmailReplyFn = defineFunction({
  name: "gmailReplyV2",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 256,
  resourceGroupName: "data",
});
