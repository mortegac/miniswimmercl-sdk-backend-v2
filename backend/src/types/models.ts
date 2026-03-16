/**
 * Tipos de dominio — espejo del GraphQL schema.
 * Los tipos DynamoDB (con PK/SK) se definen en utils/dynamodb.ts
 */

export type CustomerStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED" | "PROSPECT";
export type UserRole = "ADMIN" | "TECHNICIAN" | "SALES" | "VIEWER";
export type UserStatus = "ACTIVE" | "INACTIVE" | "PENDING_VERIFICATION";
export type WebformStatus = "PENDING" | "IN_REVIEW" | "RESOLVED" | "REJECTED";
export type WebformType =
  | "MAINTENANCE_REQUEST"
  | "QUOTE_REQUEST"
  | "EMERGENCY"
  | "COMPLAINT"
  | "GENERAL_INQUIRY";

export interface Address {
  street: string;
  number: string;
  apartment?: string;
  city: string;
  region: string;
  postalCode?: string;
  country: string;
}

export interface CustomerContact {
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  isPrimary: boolean;
}

export interface Customer {
  id: string;
  rut: string;
  companyName: string;
  tradeName?: string;
  email: string;
  phone?: string;
  address?: Address;
  status: CustomerStatus;
  contacts?: CustomerContact[];
  elevatorCount?: number;
  contractStartDate?: string;
  contractEndDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface User {
  id: string;
  cognitoId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  phone?: string;
  avatarUrl?: string;
  assignedCustomers?: string[];
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Webform {
  id: string;
  type: WebformType;
  status: WebformStatus;
  customerId?: string;
  submitterName: string;
  submitterEmail: string;
  submitterPhone?: string;
  subject: string;
  message: string;
  metadata?: Record<string, unknown>;
  assignedTo?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateCustomerInput {
  rut: string;
  companyName: string;
  tradeName?: string;
  email: string;
  phone?: string;
  address?: Address;
  contacts?: CustomerContact[];
  elevatorCount?: number;
  contractStartDate?: string;
  contractEndDate?: string;
  notes?: string;
}

export interface UpdateCustomerInput extends Partial<CreateCustomerInput> {
  id: string;
  status?: CustomerStatus;
}

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phone?: string;
  temporaryPassword: string;
}

export interface UpdateUserInput {
  id: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  status?: UserStatus;
  phone?: string;
  assignedCustomers?: string[];
}

export interface CreateWebformInput {
  type: WebformType;
  customerId?: string;
  submitterName: string;
  submitterEmail: string;
  submitterPhone?: string;
  subject: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateWebformInput {
  id: string;
  status?: WebformStatus;
  assignedTo?: string;
  resolutionNotes?: string;
  resolvedAt?: string;
}
