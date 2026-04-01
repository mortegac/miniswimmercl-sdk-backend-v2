import { defineFunction } from "@aws-amplify/backend";

export const listCognitoUsersFn = defineFunction({
  name: "listCognitoUsers",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 15,
  resourceGroupName: "data",  // mismo stack que data → data→auth es dirección válida
});
