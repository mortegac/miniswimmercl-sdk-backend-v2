import { defineFunction } from "@aws-amplify/backend";

export const postConfirmationFn = defineFunction({
  name: "postConfirmation",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 10,
  resourceGroupName: "auth",  // mismo stack que auth → evita dependencia circular con data
});
