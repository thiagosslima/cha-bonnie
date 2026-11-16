export type Attendance = 'yes' | 'maybe' | 'no'
export type DiaperSize = 'RN' | 'P' | 'M' | 'G' | 'XG'
export const DIAPER_SIZES: DiaperSize[] = ['RN', 'P', 'M', 'G', 'XG']

export interface PublicEvent {
  id: string
  slug: string
  city: string
  state: string
  title: string
  event_date: string // YYYY-MM-DD
  event_time: string // HH:MM
  venue: string
  venue_detail: string | null
  address_line1: string
  address_line2: string | null
  maps_url: string | null
  theme_primary: string
  theme_soft: string
  heart_emoji: string
  welcome_message: string
  msg_confirmed: string
  msg_maybe: string
  msg_declined: string
  rsvp_open: boolean
}

export interface MyRsvp {
  guest_name: string
  attendance: Attendance
  diaper_size: DiaperSize | null
  event_slug: string
  created_at: string
  updated_at: string
}

export interface GiftSuggestion {
  name: string
  description: string | null
  image_url: string | null
  price_tier: 'barato' | 'medio' | 'caro' | null
}

export interface DiaperRecommendation {
  recommended: DiaperSize | null
  sizes: DiaperSize[]
}
