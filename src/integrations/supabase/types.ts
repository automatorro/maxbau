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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_rules: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          discount_percent: number
          id: string
          label: string | null
          min_quantity: number | null
          product_id: string | null
          rule_type: Database["public"]["Enums"]["discount_rule_type"]
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          discount_percent?: number
          id?: string
          label?: string | null
          min_quantity?: number | null
          product_id?: string | null
          rule_type: Database["public"]["Enums"]["discount_rule_type"]
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          discount_percent?: number
          id?: string
          label?: string | null
          min_quantity?: number | null
          product_id?: string | null
          rule_type?: Database["public"]["Enums"]["discount_rule_type"]
        }
        Relationships: [
          {
            foreignKeyName: "discount_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      echivalente_produse: {
        Row: {
          category_id: string | null
          category_path: string | null
          cerere_text: string
          cod_intern: string | null
          creat_de: string | null
          created_at: string
          denumire_completa: string | null
          id: string
          nota_echivalenta: string | null
          pret_lista: number | null
          product_id: string
          scor_relevanta: number | null
          unit: string | null
        }
        Insert: {
          category_id?: string | null
          category_path?: string | null
          cerere_text: string
          cod_intern?: string | null
          creat_de?: string | null
          created_at?: string
          denumire_completa?: string | null
          id?: string
          nota_echivalenta?: string | null
          pret_lista?: number | null
          product_id: string
          scor_relevanta?: number | null
          unit?: string | null
        }
        Update: {
          category_id?: string | null
          category_path?: string | null
          cerere_text?: string
          cod_intern?: string | null
          creat_de?: string | null
          created_at?: string
          denumire_completa?: string | null
          id?: string
          nota_echivalenta?: string | null
          pret_lista?: number | null
          product_id?: string
          scor_relevanta?: number | null
          unit?: string | null
        }
        Relationships: []
      }
      price_sheet_items: {
        Row: {
          cantitate_palet: string | null
          cod_furnizor: string | null
          consum: string | null
          created_at: string
          extra_data: Json | null
          id: string
          label: string | null
          price: number
          price_sheet_id: string
          product_id: string
          unit: string | null
        }
        Insert: {
          cantitate_palet?: string | null
          cod_furnizor?: string | null
          consum?: string | null
          created_at?: string
          extra_data?: Json | null
          id?: string
          label?: string | null
          price: number
          price_sheet_id: string
          product_id: string
          unit?: string | null
        }
        Update: {
          cantitate_palet?: string | null
          cod_furnizor?: string | null
          consum?: string | null
          created_at?: string
          extra_data?: Json | null
          id?: string
          label?: string | null
          price?: number
          price_sheet_id?: string
          product_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_sheet_items_price_sheet_id_fkey"
            columns: ["price_sheet_id"]
            isOneToOne: false
            referencedRelation: "price_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_sheet_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      price_sheets: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          received_at: string | null
          source: string | null
          supplier_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          received_at?: string | null
          source?: string | null
          supplier_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          received_at?: string | null
          source?: string | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_sheets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string | null
          category_id: string | null
          cod_intern: string
          created_at: string
          denumire_completa: string
          description: string | null
          grile_pret: Json | null
          id: string
          image_url: string | null
          manufacturer: string | null
          pack_quantity: string | null
          packaging: string | null
          pret_lista: number
          source_url: string | null
          specifications: Json | null
          supplier_id: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          category_id?: string | null
          cod_intern: string
          created_at?: string
          denumire_completa: string
          description?: string | null
          grile_pret?: Json | null
          id?: string
          image_url?: string | null
          manufacturer?: string | null
          pack_quantity?: string | null
          packaging?: string | null
          pret_lista?: number
          source_url?: string | null
          specifications?: Json | null
          supplier_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          category_id?: string | null
          cod_intern?: string
          created_at?: string
          denumire_completa?: string
          description?: string | null
          grile_pret?: Json | null
          id?: string
          image_url?: string | null
          manufacturer?: string | null
          pack_quantity?: string | null
          packaging?: string | null
          pret_lista?: number
          source_url?: string | null
          specifications?: Json | null
          supplier_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quote_items: {
        Row: {
          cerere_initiala: string | null
          cod_intern: string
          created_at: string
          denumire: string
          discount_percent: number | null
          id: string
          nota_ai: Json | null
          pret_final: number
          pret_unitar: number
          product_id: string | null
          quantity: number
          quote_id: string
          subtotal: number
          unit: string | null
        }
        Insert: {
          cerere_initiala?: string | null
          cod_intern: string
          created_at?: string
          denumire: string
          discount_percent?: number | null
          id?: string
          nota_ai?: Json | null
          pret_final?: number
          pret_unitar?: number
          product_id?: string | null
          quantity?: number
          quote_id: string
          subtotal?: number
          unit?: string | null
        }
        Update: {
          cerere_initiala?: string | null
          cod_intern?: string
          created_at?: string
          denumire?: string
          discount_percent?: number | null
          id?: string
          nota_ai?: Json | null
          pret_final?: number
          pret_unitar?: number
          product_id?: string | null
          quantity?: number
          quote_id?: string
          subtotal?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          created_at: string
          id: string
          max_discount_percent: number | null
          project_description: string | null
          status: Database["public"]["Enums"]["quote_status"]
          total_gross: number | null
          total_net: number | null
          total_tva: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          created_at?: string
          id?: string
          max_discount_percent?: number | null
          project_description?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          total_gross?: number | null
          total_net?: number | null
          total_tva?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          created_at?: string
          id?: string
          max_discount_percent?: number | null
          project_description?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          total_gross?: number | null
          total_net?: number | null
          total_tva?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      retete_constructii: {
        Row: {
          category: string | null
          created_at: string
          id: string
          materials: Json
          recipe_name: string
          status: string | null
          unit: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id: string
          materials: Json
          recipe_name: string
          status?: string | null
          unit?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          materials?: Json
          recipe_name?: string
          status?: string | null
          unit?: string | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          ai_column_map: Json | null
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          ai_column_map?: Json | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          ai_column_map?: Json | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      discount_rule_type: "quantity" | "payment" | "transport" | "promo"
      quote_status: "draft" | "sent" | "accepted"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "moderator", "user"],
      discount_rule_type: ["quantity", "payment", "transport", "promo"],
      quote_status: ["draft", "sent", "accepted"],
    },
  },
} as const
