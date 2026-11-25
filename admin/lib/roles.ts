import { STAFF_ROLES, type StaffRole } from './options';

export const ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: 'Super Admin',
  coordinator: 'Coordinator',
  counsellor: 'Counsellor',
  crm: 'CRM',
};

/**
 * CRM staff work only on the CRM page (package purchases of their own clients). Every other page sends them there,
 * and the database closes clients, assessments and reports for a CRM login (migration 20261124000000).
 */
export const CRM_HOME = '/crm';
export function isCrm(role: string): boolean {
  return role === 'crm';
}

/** The CRM page's filter value for packages that wait for a CRM person. */
export const CRM_NOT_ASSIGNED = 'none';

// Roles a super admin can provision on the Team page. Super admins are set up by the owner.
export const TEAM_ROLES = STAFF_ROLES.filter(
  (role): role is Exclude<StaffRole, 'super_admin'> => role !== 'super_admin'
);
export type TeamRole = (typeof TEAM_ROLES)[number];

export function isTeamRole(value: unknown): value is TeamRole {
  return (TEAM_ROLES as readonly unknown[]).includes(value);
}
