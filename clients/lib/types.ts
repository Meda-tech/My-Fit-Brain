import type { Gender, RelationshipStatus } from './options';

export type { Gender, RelationshipStatus };

export interface ClientRecord {
  id: string; // stable application UUID
  auth_user_id: string | null;
  phone: string; // normalized E.164
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
}

export type SupportedLanguage = 'en' | 'hi';
