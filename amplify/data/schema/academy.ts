import { a } from "@aws-amplify/backend";

// ─── ACADEMIA ────────────────────────────────────────────────────────────────

export const academySchema = a.schema({
  v2TypeStatus: a.enum([
    "CERTIFICATION_COMPLETED",
    "CERTIFICATION_IN_PROGRESS",
    "WEB_FORM_ENTRY",
    "ABANDONED",
  ]),

  v2TypeOfPresence: a.enum(["IN_PERSON", "VIRTUAL", "HYBRID"]),

  v2TypeOfTitle: a.enum([
    "CERTIFICATE_OF_ATTENDANCE",
    "CERTIFICATE_OF_COMPLETION",
  ]),

  v2AcademyStudents: a
    .model({
      status: a.ref("v2TypeStatus").required(),
      presence: a.ref("v2TypeOfPresence").required(), // default IN_PERSON at app level
      name: a.string().required(),
      urlImage: a.string().required(),
      email: a.string().required(),
      birthdate: a.datetime().required(),
      years: a.integer().required(),
      address: a.string().default(""),
      country: a.string().default("Chile"),
      phone: a.string().default(""),
      profession: a.string().default(""),
      studiesRelated: a.string().default(""),
      medicalHistory: a.string().default(""),
      emergencyContact: a.string().default(""),
      isPaid: a.boolean(),
      isSponsored: a.boolean(),
      hasAgreement: a.boolean(),
      companyAgreement: a.string().default(""),
      // Relations
      certificate: a.hasOne("v2Certificates", "academyStudentsId"),
      enrollments: a.hasMany("v2AcademyEnrollment", "studentsId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2AcademyEnrollment: a
    .model({
      amountPaid: a.float().required(),
      date: a.string().required(),
      wasDeleted: a.boolean().default(false),
      wasPaid: a.boolean().default(false),
      user: a.string().required(),
      // Foreign Keys
      studentsId: a.id().required(),
      courseId: a.id().required(),
      shoppingCartDetailId: a.id(),
      // Relations
      students: a.belongsTo("v2AcademyStudents", "studentsId"),
      course: a.belongsTo("v2AcademyCourses", "courseId"),
      shoppingCartDetail: a.hasOne("v2ShoppingCartDetail", "academyEnrollmentId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2AcademyCourses: a
    .model({
      name: a.string().required(),
      description: a.string(),
      address: a.string(),
      mapurl: a.string(),
      isActive: a.boolean().default(true),
      // Relations
      enrollments: a.hasMany("v2AcademyEnrollment", "courseId"),
      certificate: a.hasOne("v2Certificates", "academyCoursesId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2Certificates: a
    .model({
      title: a.ref("v2TypeOfTitle").required(),
      studentName: a.string().required(),
      instructorName: a.string().required(),
      instructorSignature: a.string().required(),
      descriptionOne: a.string().required(),
      theoreticalHours: a.integer(),
      practicalHours: a.integer(),
      date: a.datetime(),
      isOfficialCertification: a.boolean(),
      location: a.string().required(),
      // Foreign Keys
      academyStudentsId: a.id(),
      academyCoursesId: a.id(),
      // Relations
      student: a.belongsTo("v2AcademyStudents", "academyStudentsId"),
      course: a.belongsTo("v2AcademyCourses", "academyCoursesId"),
    })
    .authorization((allow) => [allow.authenticated()]),
});
