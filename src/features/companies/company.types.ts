export type LeadStatus =
  | "DISCOVERED"
  | "ENRICHING"
  | "ENRICHED"
  | "QUALIFIED"
  | "READY"
  | "DISQUALIFIED";

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

  cnpj: string | null;
  legal_name: string | null;
  cnae: string | null;
  company_size: string | null;
  registration_status: string | null;
  opened_at: string | null;
  capital: number | null;

  address: string | null;
  category: string | null;
  rating: number | null;
  reviews_count: number | null;

  domain: string | null;
  phone_normalized: string | null;

  lead_status: LeadStatus;
  disqualified_reason: string | null;

  list_id: number | null;
  maps_url: string | null;
  business_status: string | null;

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

  cnpj?: string;
  address?: string;
  category?: string;
  rating?: number;
  reviewsCount?: number;

  /** Lista de prospecção que originou a empresa. */
  listId?: number;
  mapsUrl?: string;
  businessStatus?: string;
}

export type SourceType =
  | "GOOGLE_PLACES"
  | "CNPJ"
  | "WEBSITE"
  | "MANUAL";
