import { a } from "@aws-amplify/backend";

// ─── EVALUACIONES ────────────────────────────────────────────────────────────

export const evaluationsSchema = a.schema({
  v2EvaluationLevel: a
    .model({
      ico: a.string(),
      name: a.string(),
      description: a.string(),
      startingAge: a.float(),
      endingAge: a.float(),
      order: a.integer(),
      // Relations
      evaluationObjectives: a.hasMany("v2EvaluationObjetives", "evaluationLevelId"),
      studentEvaluations: a.hasMany("v2StudentEvaluations", "evaluationLevelId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2EvaluationObjetives: a
    .model({
      texto: a.string(),
      isMandatory: a.boolean().default(false),
      isActive: a.boolean().default(true),
      // Foreign Keys
      evaluationLevelId: a.id().required(),
      // Relations
      evaluationLevel: a.belongsTo("v2EvaluationLevel", "evaluationLevelId"),
      studentEvaluationsDetails: a.hasMany("v2StudentEvaluationsDetail", "evaluationObjectiveId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2StudentEvaluations: a
    .model({
      date: a.datetime(),
      previousLevel: a.string(),
      sessionsCarriedOut: a.integer(),
      age: a.float(),
      wasApproved: a.boolean(),
      observations: a.string(),
      // Foreign Keys
      studentId: a.id().required(),
      evaluationLevelId: a.id().required(),
      userId: a.id().required(),
      // Relations
      student: a.belongsTo("v2Student", "studentId"),
      evaluationLevel: a.belongsTo("v2EvaluationLevel", "evaluationLevelId"),
      user: a.belongsTo("v2Users", "userId"),
      studentEvaluationsDetails: a.hasMany("v2StudentEvaluationsDetail", "studentEvaluationsId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2StudentEvaluationsDetail: a
    .model({
      text: a.string(),
      wasAchieved: a.boolean(),
      // Foreign Keys
      studentEvaluationsId: a.id().required(),
      evaluationObjectiveId: a.id().required(),
      // Relations
      studentEvaluation: a.belongsTo("v2StudentEvaluations", "studentEvaluationsId"),
      evaluationObjective: a.belongsTo("v2EvaluationObjetives", "evaluationObjectiveId"),
    })
    .authorization((allow) => [allow.authenticated()]),
});
