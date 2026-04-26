import { defineFunction } from "@aws-amplify/backend";

export const mercadopagoStartFn = defineFunction({
  name: "mercadopagoStartV2",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
