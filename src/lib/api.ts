import { supabase } from './supabase'
import type { Attendance, DiaperRecommendation, DiaperSize, GiftSuggestion, MyRsvp, PublicEvent } from './types'

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const api = {
  events: () => rpc<PublicEvent[]>('get_public_events'),
  event: (slug: string) => rpc<PublicEvent>('get_public_event', { p_slug: slug }),
  diaperRecommendation: (slug: string) => rpc<DiaperRecommendation>('get_diaper_recommendation', { p_slug: slug }),
  giftSuggestions: () => rpc<GiftSuggestion[]>('get_gift_suggestions'),
  myRsvp: (token: string) => rpc<MyRsvp>('get_my_rsvp', { p_edit_token: token }),
  submitRsvp: (a: { slug: string; name: string; attendance: Attendance; diaper: DiaperSize | null; token: string; requestId: string }) =>
    rpc<MyRsvp>('submit_rsvp', {
      p_slug: a.slug,
      p_guest_name: a.name,
      p_attendance: a.attendance,
      p_diaper_size: a.diaper,
      p_edit_token: a.token,
      p_client_request_id: a.requestId,
    }),
  updateRsvp: (a: { token: string; name: string; attendance: Attendance; diaper: DiaperSize | null }) =>
    rpc<MyRsvp>('update_my_rsvp', { p_edit_token: a.token, p_guest_name: a.name, p_attendance: a.attendance, p_diaper_size: a.diaper }),
}
