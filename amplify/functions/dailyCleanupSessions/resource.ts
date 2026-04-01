import { defineFunction } from "@aws-amplify/backend";

export const dailyCleanupSessionsFn = defineFunction({
  name: "dailyCleanupSessions",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 300, // 5 min — el Scan puede tomar tiempo con muchos registros
  memoryMB: 512,
  resourceGroupName: "data", // mismo stack que data → puede referenciar tablas sin circular dep
});
