import type { Gender, RelationshipStatus, StaffRole } from './options';

export type { Gender, RelationshipStatus, StaffRole };

export interface Profile {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string;
  role: StaffRole;
  is_active: boolean;
  /** Question bank rights (Task 03 migration). Undefined before that migration is applied. */
  can_edit_content?: boolean;
  can_approve_content?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientRecord {
  id: string;
  auth_user_id: string | null;
  phone: string;
  full_name: string;
  gender: Gender;
  age: number;
  marital_status: RelationshipStatus;
  city?: string | null;
  state?: string | null;
  email?: string | null;
  created_by_profile_id?: string | null;
  created_at: string;
  updated_at: string;
  // Optional expanded join
  creator_name?: string | null;
}
