import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/encryption';
import { geocodeAddress } from '@/lib/geocoding';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ProfileSyncInput = {
  firstName: string;
  lastName: string;
  phone?: string | null;
  address: string;
  city: string;
  state: string;
  zip?: string | null;
};

function normalizeValue(value?: string | null) {
  return String(value || '').trim();
}

async function geocodeEmployeeAddress(input: {
  address: string;
  city: string;
  state: string;
  zip?: string | null;
}) {
  const address = normalizeValue(input.address);
  const city = normalizeValue(input.city);
  const state = normalizeValue(input.state);
  const zip = normalizeValue(input.zip);

  if (!address || !city || !state) {
    return { latitude: null as number | null, longitude: null as number | null };
  }

  // Keep the same street normalization already used in profile upload.
  const normalizedAddress = address.replace(/^(\d+)([A-Z])/i, '$1 $2').trim();
  const addressLower = normalizedAddress.toLowerCase();
  const hasCity = city ? addressLower.includes(city.toLowerCase()) : false;
  const hasState = state ? addressLower.includes(state.toLowerCase()) : false;

  let geocodeResult = null;

  if (hasCity && hasState) {
    geocodeResult = await geocodeAddress(normalizedAddress, '', '', '');
  }

  if (!geocodeResult) {
    let streetAddress = normalizedAddress;
    if (hasCity) {
      const cityIndex = normalizedAddress.toLowerCase().indexOf(city.toLowerCase());
      if (cityIndex > 0) {
        streetAddress = normalizedAddress.substring(0, cityIndex).trim();
      }
    }

    geocodeResult = await geocodeAddress(streetAddress, city, state, zip || undefined);
  }

  return {
    latitude: geocodeResult?.latitude ?? null,
    longitude: geocodeResult?.longitude ?? null,
  };
}

export async function syncProfileFromEmployeeInformation(params: {
  supabase: SupabaseClient<any, any, any>;
  userId: string;
  input: ProfileSyncInput;
}) {
  const { userId, input } = params;

  const firstName = normalizeValue(input.firstName);
  const lastName = normalizeValue(input.lastName);
  const phone = normalizeValue(input.phone);
  const address = normalizeValue(input.address);
  const city = normalizeValue(input.city);
  const state = normalizeValue(input.state).toUpperCase();
  const zip = normalizeValue(input.zip);

  const { latitude, longitude } = await geocodeEmployeeAddress({
    address,
    city,
    state,
    zip,
  });

  const profilePayload = {
    user_id: userId,
    first_name: encrypt(firstName),
    last_name: encrypt(lastName),
    phone: phone ? encrypt(phone) : null,
    address: address ? encrypt(address) : null,
    city: city || null,
    state,
    zip_code: zip || null,
    latitude,
    longitude,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'user_id' })
    .select('id, user_id, latitude, longitude, city, state, zip_code')
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to sync profile from employee information');
  }

  return data;
}
