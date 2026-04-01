import { defineAuth } from "@aws-amplify/backend";
import { postConfirmationFn } from "../functions/postConfirmation/resource";

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  triggers: {
    postConfirmation: postConfirmationFn,
  },
});
