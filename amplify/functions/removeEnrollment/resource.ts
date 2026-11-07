import { defineFunction } from "@aws-amplify/backend";

export const removeEnrollmentFn = defineFunction({
  name: "removeEnrollmentV2",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
