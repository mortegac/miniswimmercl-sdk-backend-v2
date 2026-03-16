import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";

/**
 * V2 Backend - Amplify Gen 2
 *
 * Backend independiente del Gen 1. No interfiere con producción.
 *
 * Para desarrollo local:   npx ampx sandbox --profile miniswimmer
 * Para CI/CD:              npx ampx pipeline-deploy
 */
export const backend = defineBackend({
  auth,
  data,
});
