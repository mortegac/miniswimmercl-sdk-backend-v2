import { a } from "@aws-amplify/backend";

// ─── ROLES & PERMISSIONS ─────────────────────────────────────────────────────
// manyToMany → tablas join explícitas (Gen 2 v1.x compatible)

export const rolesSchema = a.schema({
  v2Roles: a
    .model({
      name: a.string().required(),
      displayName: a.string().required(),
      icon: a.string().required(),
      users: a.hasMany("v2Users", "roleId"),        // ← corrección: dirección correcta
      rolPermissions: a.hasMany("v2RolPermissions", "roleId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2Permissions: a
    .model({
      displayName: a.string().required(),
      name: a.string().required(),
      icon: a.string().required(),
      isVisible: a.boolean().default(true),          // ← nuevo
      isLeaf: a.boolean().default(true),             // ← nuevo
      order: a.integer().default(99),
      padreId: a.id(),
      Padre: a.belongsTo("v2Permissions", "padreId"),
      Submenu: a.hasMany("v2Permissions", "padreId"),
      rolPermissions: a.hasMany("v2RolPermissions", "permissionId"),
      userPermissions: a.hasMany("v2UserPermissions", "permissionId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  // Join table: Roles ↔ Permissions
  v2RolPermissions: a
    .model({
      roleId: a.id().required(),
      permissionId: a.id().required(),
      role: a.belongsTo("v2Roles", "roleId"),
      permission: a.belongsTo("v2Permissions", "permissionId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  // Join table: Users ↔ Permissions (asignación directa, independiente de roles)
  v2UserPermissions: a
    .model({
      userId: a.id().required(),
      permissionId: a.id().required(),
      user: a.belongsTo("v2Users", "userId"),
      permission: a.belongsTo("v2Permissions", "permissionId"),
    })
    .authorization((allow) => [allow.authenticated()]),
});
