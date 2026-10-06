export interface Company {
  id: number;
  name: string;

  segment: string | null;

  city: string | null;
  state: string | null;

  website: string | null;
  phone: string | null;
  instagram: string | null;

  google_place_id: string | null;

  created_at: string;
  updated_at: string;
}

export interface CreateCompanyInput {
  name: string;

  segment?: string;

  city?: string;
  state?: string;

  website?: string;
  phone?: string;
  instagram?: string;

  googlePlaceId?: string;
}