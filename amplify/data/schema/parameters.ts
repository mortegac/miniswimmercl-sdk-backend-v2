import { a } from "@aws-amplify/backend";

// ─── PARAMETERS ──────────────────────────────────────────────────────────────

export const parametersSchema = a.schema({
  v2ParametersEnc: a
    .model({
      description: a.string(),
      // Relations
      typeOfParameter: a.hasMany("v2Parameters", "typeOfParameterId"),
    })
    .authorization((allow) => [allow.guest()]),

  v2Parameters: a
    .model({
      label: a.string().required(),
      value: a.string().required(),
      country: a.string().required(),
      idParent: a.string().default(""),
      // Foreign Keys
      typeOfParameterId: a.id(),
      // Relations
      typeOfParameter: a.belongsTo("v2ParametersEnc", "typeOfParameterId"),
      metadata: a.hasMany("v2Metadata", "parametersId"),
    })
    .secondaryIndexes((index) => [
      index("country").sortKeys(["label"]).name("byCountry"),
    ])
    .authorization((allow) => [allow.guest()]),

  v2Metadata: a
    .model({
      key: a.string(),
      value: a.string(),
      // Foreign Keys
      parametersId: a.id(),
      // Relations
      metadata: a.belongsTo("v2Parameters", "parametersId"),
    })
    .authorization((allow) => [allow.guest()]),
});
