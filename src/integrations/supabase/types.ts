export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activated_emails: {
        Row: {
          access_until: string | null
          approved: boolean
          created_at: string
          email: string
          id: string
          reactivation_pending: boolean
          session_id: string | null
          used_at: string | null
        }
        Insert: {
          access_until?: string | null
          approved?: boolean
          created_at?: string
          email: string
          id?: string
          reactivation_pending?: boolean
          session_id?: string | null
          used_at?: string | null
        }
        Update: {
          access_until?: string | null
          approved?: boolean
          created_at?: string
          email?: string
          id?: string
          reactivation_pending?: boolean
          session_id?: string | null
          used_at?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      bridge_api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          label: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          label: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          label?: string
        }
        Relationships: []
      }
      broker_connections: {
        Row: {
          account_number: string
          api_key_encrypted: string | null
          balance: number | null
          bridge_url: string | null
          broker: string
          created_at: string
          currency: string | null
          equity: number | null
          id: string
          last_sync: string | null
          leverage: number | null
          login: string | null
          owner_email: string
          password_encrypted: string | null
          platform: string
          server: string | null
          status: string
        }
        Insert: {
          account_number: string
          api_key_encrypted?: string | null
          balance?: number | null
          bridge_url?: string | null
          broker: string
          created_at?: string
          currency?: string | null
          equity?: number | null
          id?: string
          last_sync?: string | null
          leverage?: number | null
          login?: string | null
          owner_email: string
          password_encrypted?: string | null
          platform: string
          server?: string | null
          status?: string
        }
        Update: {
          account_number?: string
          api_key_encrypted?: string | null
          balance?: number | null
          bridge_url?: string | null
          broker?: string
          created_at?: string
          currency?: string | null
          equity?: number | null
          id?: string
          last_sync?: string | null
          leverage?: number | null
          login?: string | null
          owner_email?: string
          password_encrypted?: string | null
          platform?: string
          server?: string | null
          status?: string
        }
        Relationships: []
      }
      chart_scan_usage: {
        Row: {
          day: string
          email: string
          updated_at: string
          used: number
        }
        Insert: {
          day: string
          email: string
          updated_at?: string
          used?: number
        }
        Update: {
          day?: string
          email?: string
          updated_at?: string
          used?: number
        }
        Relationships: []
      }
      ea_configs: {
        Row: {
          code: string
          created_at: string
          owner_id: string
          payload: Json
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          owner_id: string
          payload?: Json
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          owner_id?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      ea_licenses: {
        Row: {
          code: string
          created_at: string
          ea_id: string
          id: string
          owner_email: string
        }
        Insert: {
          code: string
          created_at?: string
          ea_id: string
          id?: string
          owner_email: string
        }
        Update: {
          code?: string
          created_at?: string
          ea_id?: string
          id?: string
          owner_email?: string
        }
        Relationships: []
      }
      ea_symbols: {
        Row: {
          action: string
          allowed: boolean
          created_at: string
          ea_id: string
          id: string
          lot_size: number
          platform: string
          symbol: string
        }
        Insert: {
          action?: string
          allowed?: boolean
          created_at?: string
          ea_id: string
          id?: string
          lot_size?: number
          platform?: string
          symbol: string
        }
        Update: {
          action?: string
          allowed?: boolean
          created_at?: string
          ea_id?: string
          id?: string
          lot_size?: number
          platform?: string
          symbol?: string
        }
        Relationships: []
      }
      gemini_keys: {
        Row: {
          api_key: string
          slot: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          api_key: string
          slot: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          api_key?: string
          slot?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      gemini_verdicts: {
        Row: {
          bar_time: number
          confidence: number
          created_at: string
          reason: string
          side: string
          symbol: string
        }
        Insert: {
          bar_time: number
          confidence?: number
          created_at?: string
          reason?: string
          side: string
          symbol: string
        }
        Update: {
          bar_time?: number
          confidence?: number
          created_at?: string
          reason?: string
          side?: string
          symbol?: string
        }
        Relationships: []
      }
      guard_accounts: {
        Row: {
          created_at: string
          enabled: boolean
          events: Json
          id: string
          last_check_at: string | null
          last_status: string | null
          login: string
          password_encrypted: string
          platform: string
          server: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          events?: Json
          id?: string
          last_check_at?: string | null
          last_status?: string | null
          login: string
          password_encrypted: string
          platform: string
          server: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          events?: Json
          id?: string
          last_check_at?: string | null
          last_status?: string | null
          login?: string
          password_encrypted?: string
          platform?: string
          server?: string
          updated_at?: string
        }
        Relationships: []
      }
      manual_signals: {
        Row: {
          comment: string | null
          consumed_at: string | null
          created_at: string
          delivered_at: string | null
          id: string
          lot: number
          magic: number
          owner_id: string
          side: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
        }
        Insert: {
          comment?: string | null
          consumed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          lot?: number
          magic: number
          owner_id: string
          side: string
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
        }
        Update: {
          comment?: string | null
          consumed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          lot?: number
          magic?: number
          owner_id?: string
          side?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
        }
        Relationships: []
      }
      mtapi_keys: {
        Row: {
          api_key: string
          created_at: string
          platform: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          api_key: string
          created_at?: string
          platform: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          api_key?: string
          created_at?: string
          platform?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          merchant_payment_id: string
          pf_payment_id: string | null
          purpose: string
          raw: Json | null
          status: string
          updated_at: string
          user_email: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          merchant_payment_id: string
          pf_payment_id?: string | null
          purpose?: string
          raw?: Json | null
          status?: string
          updated_at?: string
          user_email: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          merchant_payment_id?: string
          pf_payment_id?: string | null
          purpose?: string
          raw?: Json | null
          status?: string
          updated_at?: string
          user_email?: string
        }
        Relationships: []
      }
      payouts: {
        Row: {
          admin_email: string
          amount: number
          bank_reference: string | null
          created_at: string
          currency: string
          id: string
          pf_response: Json | null
          status: string
        }
        Insert: {
          admin_email: string
          amount: number
          bank_reference?: string | null
          created_at?: string
          currency?: string
          id?: string
          pf_response?: Json | null
          status?: string
        }
        Update: {
          admin_email?: string
          amount?: number
          bank_reference?: string | null
          created_at?: string
          currency?: string
          id?: string
          pf_response?: Json | null
          status?: string
        }
        Relationships: []
      }
      portal_licenses: {
        Row: {
          active: boolean
          created_at: string
          duration: string
          ea_name: string
          ea_payload: Json
          id: string
          issued_by: string | null
          key: string
          redeemed_at: string | null
          user_name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          duration?: string
          ea_name: string
          ea_payload?: Json
          id?: string
          issued_by?: string | null
          key: string
          redeemed_at?: string | null
          user_name?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          duration?: string
          ea_name?: string
          ea_payload?: Json
          id?: string
          issued_by?: string | null
          key?: string
          redeemed_at?: string | null
          user_name?: string
        }
        Relationships: []
      }
      portal_state: {
        Row: {
          data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          data?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approved: boolean
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_admin: boolean
          mentor_code: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_admin?: boolean
          mentor_code?: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_admin?: boolean
          mentor_code?: string
        }
        Relationships: []
      }
      promo_leads: {
        Row: {
          contact: string
          created_at: string
          id: string
          message: string
          name: string
          owner_id: string
          site_id: string
        }
        Insert: {
          contact: string
          created_at?: string
          id?: string
          message?: string
          name: string
          owner_id: string
          site_id: string
        }
        Update: {
          contact?: string
          created_at?: string
          id?: string
          message?: string
          name?: string
          owner_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_leads_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "promo_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_sites: {
        Row: {
          accent: string
          bot_name: string
          created_at: string
          cta_label: string
          description: string
          features: string[]
          headline: string
          id: string
          image: string | null
          offer_ends_at: string | null
          offer_percent: number
          old_price: string
          phone_interface: string
          price_text: string
          published: boolean
          slug: string
          stat_text: string
          tagline: string
          telegram: string
          updated_at: string
          user_id: string
          views: number
          whatsapp: string
        }
        Insert: {
          accent?: string
          bot_name: string
          created_at?: string
          cta_label?: string
          description?: string
          features?: string[]
          headline?: string
          id?: string
          image?: string | null
          offer_ends_at?: string | null
          offer_percent?: number
          old_price?: string
          phone_interface?: string
          price_text?: string
          published?: boolean
          slug: string
          stat_text?: string
          tagline?: string
          telegram?: string
          updated_at?: string
          user_id: string
          views?: number
          whatsapp?: string
        }
        Update: {
          accent?: string
          bot_name?: string
          created_at?: string
          cta_label?: string
          description?: string
          features?: string[]
          headline?: string
          id?: string
          image?: string | null
          offer_ends_at?: string | null
          offer_percent?: number
          old_price?: string
          phone_interface?: string
          price_text?: string
          published?: boolean
          slug?: string
          stat_text?: string
          tagline?: string
          telegram?: string
          updated_at?: string
          user_id?: string
          views?: number
          whatsapp?: string
        }
        Relationships: []
      }
      signals: {
        Row: {
          account_number: string | null
          action: string
          broker: string | null
          created_at: string
          entry_price: number | null
          id: string
          lot_size: number | null
          raw: Json | null
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
        }
        Insert: {
          account_number?: string | null
          action: string
          broker?: string | null
          created_at?: string
          entry_price?: number | null
          id?: string
          lot_size?: number | null
          raw?: Json | null
          status?: string
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
        }
        Update: {
          account_number?: string | null
          action?: string
          broker?: string | null
          created_at?: string
          entry_price?: number | null
          id?: string
          lot_size?: number | null
          raw?: Json | null
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
        }
        Relationships: []
      }
      trade_executions: {
        Row: {
          action: string
          broker_connection_id: string | null
          created_at: string
          entry: number | null
          id: string
          lot: number | null
          message: string | null
          owner_email: string
          raw: Json | null
          side: string
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          ticket: string | null
        }
        Insert: {
          action?: string
          broker_connection_id?: string | null
          created_at?: string
          entry?: number | null
          id?: string
          lot?: number | null
          message?: string | null
          owner_email: string
          raw?: Json | null
          side: string
          status?: string
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
          ticket?: string | null
        }
        Update: {
          action?: string
          broker_connection_id?: string | null
          created_at?: string
          entry?: number | null
          id?: string
          lot?: number | null
          message?: string | null
          owner_email?: string
          raw?: Json | null
          side?: string
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
          ticket?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whop_checkouts: {
        Row: {
          checkout_id: string | null
          created_at: string
          email: string
          id: string
          membership_id: string | null
          mentor_id: string
          payment_id: string | null
          status: string
          token_hash: string
          verified_at: string | null
        }
        Insert: {
          checkout_id?: string | null
          created_at?: string
          email: string
          id?: string
          membership_id?: string | null
          mentor_id?: string
          payment_id?: string | null
          status?: string
          token_hash: string
          verified_at?: string | null
        }
        Update: {
          checkout_id?: string | null
          created_at?: string
          email?: string
          id?: string
          membership_id?: string | null
          mentor_id?: string
          payment_id?: string | null
          status?: string
          token_hash?: string
          verified_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bump_promo_view: { Args: { _slug: string }; Returns: undefined }
      consume_chart_scan: {
        Args: { _day: string; _email: string; _limit: number }
        Returns: number
      }
      generate_mentor_code: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _uid: string }; Returns: boolean }
      pull_bot_signals: {
        Args: { p_magic: number }
        Returns: {
          comment: string
          created_at: string
          id: string
          lot: number
          side: string
          stop_loss: number
          symbol: string
          take_profit: number
        }[]
      }
      submit_promo_lead: {
        Args: {
          _contact: string
          _message: string
          _name: string
          _slug: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
