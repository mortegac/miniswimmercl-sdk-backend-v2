import { defineFunction } from "@aws-amplify/backend";

export const generateEnrollmentFn = defineFunction({
  name: "generateEnrollmentV2",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 60,
  resourceGroupName: "data",
});
