import { defineFunction } from "@aws-amplify/backend";

export const gmailSyncFn = defineFunction({
  name: "gmailSyncV2",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 300,   // 5 min — full inbox sync can be slow
  memoryMB: 512,
  resourceGroupName: "data", // same stack as data → avoids circular dep when referencing tables
});
