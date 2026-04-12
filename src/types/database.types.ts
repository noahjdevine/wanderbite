/**
 * Placeholder schema — replace with generated types.
 *
 * Run `npm run types:db` after `supabase login` or with `SUPABASE_ACCESS_TOKEN` set.
 * Command: supabase gen types typescript --project-id yiajoycgiyxjvznndjge --schema public > src/types/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** Permissive placeholder until `npm run types:db` overwrites this file. */
export type Database = {
  public: {
    Tables: Record<
      string,
      {
        Row: Record<string, unknown>
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
        Relationships: []
      }
    >
    Views: Record<
      string,
      {
        Row: Record<string, unknown>
        Relationships: []
      }
    >
    Functions: Record<
      string,
      {
        Args: Record<string, unknown>
        Returns: unknown
      }
    >
    Enums: Record<string, string>
    CompositeTypes: Record<string, Record<string, unknown>>
  }
}
