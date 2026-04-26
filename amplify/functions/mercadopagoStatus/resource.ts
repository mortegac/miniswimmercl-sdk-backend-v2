import { defineFunction } from "@aws-amplify/backend";

export const mercadopagoStatusFn = defineFunction({
  name: "mercadopagoStatusV2",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
