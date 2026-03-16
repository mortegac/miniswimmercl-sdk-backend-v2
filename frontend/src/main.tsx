import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { store } from "./store";
import App from "./App";

// Configuración de Amplify — los valores vienen del CDK output
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    },
  },
  API: {
    GraphQL: {
      endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
      region: import.meta.env.VITE_AWS_REGION ?? "us-east-1",
      defaultAuthMode: "userPool",
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <Authenticator hideSignUp>
        <App />
      </Authenticator>
    </Provider>
  </React.StrictMode>
);
