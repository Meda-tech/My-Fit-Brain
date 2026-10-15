// Single source for stored option values (question bank I2 / I3) and staff roles.
// Stored values are these English strings; display labels come from i18n.
export const GENDERS = ['Male', 'Female', 'Prefer not to say'] as const;
export type Gender = (typeof GENDERS)[number];

export const RELATIONSHIP_STATUSES = [
  'Single', 'In a relationship', 'Engaged', 'Married', 'Separated', 'Divorced', 'Widowed',
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const STAFF_ROLES = ['super_admin', 'coordinator', 'counsellor'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const MIN_AGE = 18;
export const MAX_AGE = 120;

export function isGender(value: unknown): value is Gender {
  return (GENDERS as readonly unknown[]).includes(value);
}

export function isRelationshipStatus(value: unknown): value is RelationshipStatus {
  return (RELATIONSHIP_STATUSES as readonly unknown[]).includes(value);
}

export function isStaffRole(value: unknown): value is StaffRole {
  return (STAFF_ROLES as readonly unknown[]).includes(value);
}
