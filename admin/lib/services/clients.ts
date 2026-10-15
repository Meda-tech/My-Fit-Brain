import { createClient } from '../supabase/server';
import { getCurrentStaff } from '../auth';
import { normalizePhoneNumber } from '../phone';
import { ClientRecord } from '../types';
import { MAX_AGE, MIN_AGE, isGender, isRelationshipStatus } from '../options';

// Row shape returned by the clients select with the creator join (type only).
type ClientRowWithCreator = Omit<ClientRecord, 'creator_name'> & {
  profiles?: { full_name?: string | null } | null;
};

export interface CreateClientInput {
  fullName: string;
  phone: string;
  gender: string;
  age: number;
  maritalStatus: string;
  city?: string;
  state?: string;
  email?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ClientServiceResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * List clients with optional search filtering.
 * Accessible to both Super Admin and active Coordinators.
 */
export async function listClients(query?: string): Promise<ClientRecord[]> {
  const staff = await getCurrentStaff();
  if (!staff) {
    throw new Error('Unauthorized: Staff session required.');
  }

  const supabase = await createClient();
  let builder = supabase
    .from('clients')
    .select(`
      id,
      auth_user_id,
      phone,
      full_name,
      gender,
      age,
      marital_status,
      city,
      state,
      email,
      created_by_profile_id,
      created_at,
      updated_at,
      profiles:created_by_profile_id(full_name)
    `)
    .order('created_at', { ascending: false });

  if (query && query.trim().length > 0) {
    const q = query.trim();
    // Search by name, phone or email
    builder = builder.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data, error } = await builder;

  if (error) {
    console.error('Failed to list clients:', error);
    throw new Error('Database error while retrieving clients.');
  }

  return ((data || []) as unknown as ClientRowWithCreator[]).map((row) => ({
    id: row.id,
    auth_user_id: row.auth_user_id,
    phone: row.phone,
    full_name: row.full_name,
    gender: row.gender,
    age: row.age,
    marital_status: row.marital_status,
    city: row.city,
    state: row.state,
    email: row.email,
    created_by_profile_id: row.created_by_profile_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    creator_name: row.profiles?.full_name || null,
  })) as ClientRecord[];
}

/**
 * Retrieve single client record by ID.
 * Accessible to both Super Admin and active Coordinators.
 */
export async function getClientById(id: string): Promise<ClientRecord | null> {
  const staff = await getCurrentStaff();
  if (!staff) {
    throw new Error('Unauthorized: Staff session required.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clients')
    .select(`
      id,
      auth_user_id,
      phone,
      full_name,
      gender,
      age,
      marital_status,
      city,
      state,
      email,
      created_by_profile_id,
      created_at,
      updated_at,
      profiles:created_by_profile_id(full_name)
    `)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    auth_user_id: data.auth_user_id,
    phone: data.phone,
    full_name: data.full_name,
    gender: data.gender,
    age: data.age,
    marital_status: data.marital_status,
    city: data.city,
    state: data.state,
    email: data.email,
    created_by_profile_id: data.created_by_profile_id,
    created_at: data.created_at,
    updated_at: data.updated_at,
    creator_name: (data as unknown as ClientRowWithCreator).profiles?.full_name || null,
  };
}

/**
 * Create a client record from the internal portal.
 * Accessible to Super Admin and active Coordinators.
 */
export async function createClientRecord(
  input: CreateClientInput
): Promise<ClientServiceResult<ClientRecord>> {
  const staff = await getCurrentStaff();
  if (!staff) {
    return { success: false, error: 'Unauthorized: Staff session required.' };
  }

  const fullName = input.fullName.trim();
  if (!fullName || fullName.length < 2) {
    return { success: false, error: 'Full name is required (at least 2 characters).' };
  }

  // Validate and normalize phone
  const phoneResult = normalizePhoneNumber(input.phone);
  if (!phoneResult.valid) {
    return { success: false, error: phoneResult.error || 'Please enter a valid mobile number.' };
  }

  const age = Number(input.age);
  if (!Number.isInteger(age) || age < 1 || age > MAX_AGE) {
    return { success: false, error: 'Please enter the age in whole years (1 to 120).' };
  }
  if (age < MIN_AGE) {
    return { success: false, error: 'Clients must be 18 or older.' };
  }

  if (!isGender(input.gender)) {
    return { success: false, error: 'Please select a valid gender option.' };
  }
  const gender = input.gender;

  if (!isRelationshipStatus(input.maritalStatus)) {
    return { success: false, error: 'Please select a valid relationship status.' };
  }
  const maritalStatus = input.maritalStatus;

  const email = input.email?.trim() || null;
  if (email && !EMAIL_PATTERN.test(email)) {
    return { success: false, error: 'Please enter a valid email address.' };
  }

  try {
    const supabase = await createClient();

    // Check if phone already exists
    const { data: existing } = await supabase
      .from('clients')
      .select('id, full_name')
      .eq('phone', phoneResult.normalized)
      .maybeSingle();

    if (existing) {
      return {
        success: false,
        error: `A client record already exists for ${phoneResult.formatted}. Client ID: ${existing.id.slice(0, 8)}...`,
      };
    }

    // Insert record
    const { data, error } = await supabase
      .from('clients')
      .insert({
        phone: phoneResult.normalized,
        full_name: fullName,
        gender,
        age,
        marital_status: maritalStatus,
        city: input.city?.trim() || null,
        state: input.state?.trim() || null,
        email,
        created_by_profile_id: staff.profile.id,
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('Failed to create client:', error);
      return { success: false, error: 'Something went wrong. Please try again.' };
    }

    return { success: true, data: data as ClientRecord };
  } catch (err: unknown) {
    console.error('Unexpected error creating client:', err);
    return { success: false, error: 'Something went wrong. Please try again.' };
  }
}
