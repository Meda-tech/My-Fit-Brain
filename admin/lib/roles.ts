import { STAFF_ROLES, type StaffRole } from './options';

export const ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: 'Super Admin',
  coordinator: 'Coordinator',
  counsellor: 'Counsellor',
};

// Roles a super admin can provision on the Team page. Super admins are set up by the owner.
export const TEAM_ROLES = STAFF_ROLES.filter(
  (role): role is Exclude<StaffRole, 'super_admin'> => role !== 'super_admin'
);
export type TeamRole = (typeof TEAM_ROLES)[number];

export function isTeamRole(value: unknown): value is TeamRole {
  return (TEAM_ROLES as readonly unknown[]).includes(value);
}
