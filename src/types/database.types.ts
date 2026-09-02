export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  platform: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          entity_id: string | null
          entity_type: string
          id: number
          metadata: Json
          occurred_at: string
          organization_id: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          entity_id?: string | null
          entity_type: string
          id?: never
          metadata?: Json
          occurred_at?: string
          organization_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: never
          metadata?: Json
          occurred_at?: string
          organization_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          available: boolean
          code: string
          created_at: string
          currency: string
          description: string | null
          id: string
          item_type: string
          name: string
          price_month: number
          saas_product_id: string | null
          scope: string
          updated_at: string
        }
        Insert: {
          available?: boolean
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          item_type?: string
          name: string
          price_month?: number
          saas_product_id?: string | null
          scope?: string
          updated_at?: string
        }
        Update: {
          available?: boolean
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          item_type?: string
          name?: string
          price_month?: number
          saas_product_id?: string | null
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_items_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "catalog_items_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
        ]
      }
      commission_events: {
        Row: {
          amount: number
          applied_rate: number | null
          attribution_pct: number
          base_amount: number
          calculation: Json
          commission_rule_id: string
          created_at: string
          currency: string
          earned_on: string
          id: string
          invoice_line_id: string | null
          payment_id: string
          saas_product_id: string
          sales_agent_id: string
          sales_attribution_id: string
          settlement_id: string | null
          status: Database["platform"]["Enums"]["commission_status"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          applied_rate?: number | null
          attribution_pct: number
          base_amount: number
          calculation?: Json
          commission_rule_id: string
          created_at?: string
          currency?: string
          earned_on: string
          id?: string
          invoice_line_id?: string | null
          payment_id: string
          saas_product_id: string
          sales_agent_id: string
          sales_attribution_id: string
          settlement_id?: string | null
          status?: Database["platform"]["Enums"]["commission_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          applied_rate?: number | null
          attribution_pct?: number
          base_amount?: number
          calculation?: Json
          commission_rule_id?: string
          created_at?: string
          currency?: string
          earned_on?: string
          id?: string
          invoice_line_id?: string | null
          payment_id?: string
          saas_product_id?: string
          sales_agent_id?: string
          sales_attribution_id?: string
          settlement_id?: string | null
          status?: Database["platform"]["Enums"]["commission_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_events_commission_rule_id_fkey"
            columns: ["commission_rule_id"]
            isOneToOne: false
            referencedRelation: "commission_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_invoice_line_id_fkey"
            columns: ["invoice_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "commission_events_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "commission_events_sales_agent_id_fkey"
            columns: ["sales_agent_id"]
            isOneToOne: false
            referencedRelation: "sales_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_sales_attribution_id_fkey"
            columns: ["sales_attribution_id"]
            isOneToOne: false
            referencedRelation: "sales_attributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "commission_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "commission_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      commission_plans: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          saas_product_id: string | null
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          saas_product_id?: string | null
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          saas_product_id?: string | null
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_plans_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_plans_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "commission_plans_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          basis: Database["platform"]["Enums"]["commission_basis"]
          charge_kind: Database["platform"]["Enums"]["charge_kind"] | null
          commission_plan_id: string
          created_at: string
          currency: string
          fixed_amount: number | null
          id: string
          is_recurring: boolean
          max_months: number | null
          max_total_amount: number | null
          name: string
          priority: number
          rate: number | null
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          basis: Database["platform"]["Enums"]["commission_basis"]
          charge_kind?: Database["platform"]["Enums"]["charge_kind"] | null
          commission_plan_id: string
          created_at?: string
          currency?: string
          fixed_amount?: number | null
          id?: string
          is_recurring?: boolean
          max_months?: number | null
          max_total_amount?: number | null
          name: string
          priority?: number
          rate?: number | null
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          basis?: Database["platform"]["Enums"]["commission_basis"]
          charge_kind?: Database["platform"]["Enums"]["charge_kind"] | null
          commission_plan_id?: string
          created_at?: string
          currency?: string
          fixed_amount?: number | null
          id?: string
          is_recurring?: boolean
          max_months?: number | null
          max_total_amount?: number | null
          name?: string
          priority?: number
          rate?: number | null
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_commission_plan_id_fkey"
            columns: ["commission_plan_id"]
            isOneToOne: false
            referencedRelation: "commission_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_settlements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          code: string
          created_at: string
          currency: string
          id: string
          notes: string | null
          paid_at: string | null
          payment_reference: string | null
          period_end: string
          period_start: string
          sales_agent_id: string
          status: Database["platform"]["Enums"]["settlement_status"]
          total_amount: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          code: string
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_reference?: string | null
          period_end: string
          period_start: string
          sales_agent_id: string
          status?: Database["platform"]["Enums"]["settlement_status"]
          total_amount?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          code?: string
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_reference?: string | null
          period_end?: string
          period_start?: string
          sales_agent_id?: string
          status?: Database["platform"]["Enums"]["settlement_status"]
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_settlements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_settlements_sales_agent_id_fkey"
            columns: ["sales_agent_id"]
            isOneToOne: false
            referencedRelation: "sales_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          country_code: string
          created_at: string
          currency: string
          erp_code: string | null
          id: string
          is_default: boolean
          name: string
          organization_id: string
          status: Database["platform"]["Enums"]["entity_status"]
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          currency?: string
          erp_code?: string | null
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          status?: Database["platform"]["Enums"]["entity_status"]
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          currency?: string
          erp_code?: string | null
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          status?: Database["platform"]["Enums"]["entity_status"]
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
        ]
      }
      company_config: {
        Row: {
          company_id: string
          config: Json
          updated_at: string
        }
        Insert: {
          company_id: string
          config?: Json
          updated_at?: string
        }
        Update: {
          company_id?: string
          config?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_allocations: {
        Row: {
          allocation_rule: string
          cost_entry_id: string
          created_at: string
          deployment_target_id: string | null
          id: string
          organization_id: string | null
          saas_product_id: string | null
          scope: Database["platform"]["Enums"]["cost_scope"]
          tenant_id: string | null
          weight: number
        }
        Insert: {
          allocation_rule?: string
          cost_entry_id: string
          created_at?: string
          deployment_target_id?: string | null
          id?: string
          organization_id?: string | null
          saas_product_id?: string | null
          scope: Database["platform"]["Enums"]["cost_scope"]
          tenant_id?: string | null
          weight?: number
        }
        Update: {
          allocation_rule?: string
          cost_entry_id?: string
          created_at?: string
          deployment_target_id?: string | null
          id?: string
          organization_id?: string | null
          saas_product_id?: string | null
          scope?: Database["platform"]["Enums"]["cost_scope"]
          tenant_id?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "cost_alloc_deployment_target_fk"
            columns: ["deployment_target_id"]
            isOneToOne: false
            referencedRelation: "deployment_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_alloc_deployment_target_fk"
            columns: ["deployment_target_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["deployment_target_id"]
          },
          {
            foreignKeyName: "cost_allocations_cost_entry_id_fkey"
            columns: ["cost_entry_id"]
            isOneToOne: false
            referencedRelation: "cost_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "cost_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "cost_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "cost_allocations_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_allocations_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "cost_allocations_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "cost_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "cost_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      cost_entries: {
        Row: {
          amount: number
          category: Database["platform"]["Enums"]["cost_category"]
          created_at: string
          currency: string
          description: string
          id: string
          is_recurring: boolean
          metadata: Json
          period_end: string
          period_start: string
          updated_at: string
          vendor: string | null
        }
        Insert: {
          amount: number
          category: Database["platform"]["Enums"]["cost_category"]
          created_at?: string
          currency?: string
          description: string
          id?: string
          is_recurring?: boolean
          metadata?: Json
          period_end: string
          period_start: string
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          amount?: number
          category?: Database["platform"]["Enums"]["cost_category"]
          created_at?: string
          currency?: string
          description?: string
          id?: string
          is_recurring?: boolean
          metadata?: Json
          period_end?: string
          period_start?: string
          updated_at?: string
          vendor?: string | null
        }
        Relationships: []
      }
      deployment_targets: {
        Row: {
          code: string
          cost_center: string | null
          created_at: string
          deployment_mode: Database["platform"]["Enums"]["deployment_mode"]
          environment: Database["platform"]["Enums"]["environment_kind"]
          id: string
          metadata: Json
          name: string
          owner_organization_id: string | null
          provider: Database["platform"]["Enums"]["infra_provider"]
          provider_project_ref: string | null
          region: string | null
          saas_product_id: string | null
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          code: string
          cost_center?: string | null
          created_at?: string
          deployment_mode: Database["platform"]["Enums"]["deployment_mode"]
          environment?: Database["platform"]["Enums"]["environment_kind"]
          id?: string
          metadata?: Json
          name: string
          owner_organization_id?: string | null
          provider?: Database["platform"]["Enums"]["infra_provider"]
          provider_project_ref?: string | null
          region?: string | null
          saas_product_id?: string | null
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          cost_center?: string | null
          created_at?: string
          deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          environment?: Database["platform"]["Enums"]["environment_kind"]
          id?: string
          metadata?: Json
          name?: string
          owner_organization_id?: string | null
          provider?: Database["platform"]["Enums"]["infra_provider"]
          provider_project_ref?: string | null
          region?: string | null
          saas_product_id?: string | null
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployment_targets_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deployment_targets_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "deployment_targets_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "deployment_targets_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "deployment_targets_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deployment_targets_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "deployment_targets_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          amount: number | null
          charge_kind: Database["platform"]["Enums"]["charge_kind"]
          created_at: string
          currency: string
          description: string
          id: string
          invoice_id: string
          is_recurring: boolean
          quantity: number
          saas_product_id: string | null
          subscription_item_id: string | null
          tenant_id: string | null
          unit_amount: number
        }
        Insert: {
          amount?: number | null
          charge_kind: Database["platform"]["Enums"]["charge_kind"]
          created_at?: string
          currency?: string
          description: string
          id?: string
          invoice_id: string
          is_recurring?: boolean
          quantity?: number
          saas_product_id?: string | null
          subscription_item_id?: string | null
          tenant_id?: string | null
          unit_amount: number
        }
        Update: {
          amount?: number | null
          charge_kind?: Database["platform"]["Enums"]["charge_kind"]
          created_at?: string
          currency?: string
          description?: string
          id?: string
          invoice_id?: string
          is_recurring?: boolean
          quantity?: number
          saas_product_id?: string | null
          subscription_item_id?: string | null
          tenant_id?: string | null
          unit_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_collected_revenue"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_lines_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "invoice_lines_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "invoice_lines_subscription_item_id_fkey"
            columns: ["subscription_item_id"]
            isOneToOne: false
            referencedRelation: "subscription_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "invoice_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      invoices: {
        Row: {
          company_id: string | null
          created_at: string
          currency: string
          customer_organization_id: string
          due_date: string | null
          id: string
          issue_date: string | null
          metadata: Json
          notes: string | null
          number: string
          period_end: string | null
          period_start: string | null
          status: Database["platform"]["Enums"]["invoice_status"]
          subscription_id: string | null
          subtotal: number
          tax_amount: number
          total: number
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          currency?: string
          customer_organization_id: string
          due_date?: string | null
          id?: string
          issue_date?: string | null
          metadata?: Json
          notes?: string | null
          number: string
          period_end?: string | null
          period_start?: string | null
          status?: Database["platform"]["Enums"]["invoice_status"]
          subscription_id?: string | null
          subtotal?: number
          tax_amount?: number
          total?: number
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          currency?: string
          customer_organization_id?: string
          due_date?: string | null
          id?: string
          issue_date?: string | null
          metadata?: Json
          notes?: string | null
          number?: string
          period_end?: string | null
          period_start?: string | null
          status?: Database["platform"]["Enums"]["invoice_status"]
          subscription_id?: string | null
          subtotal?: number
          tax_amount?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "invoices_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "invoices_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_mrr"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["subscription_id"]
          },
        ]
      }
      org_config: {
        Row: {
          config: Json
          organization_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          organization_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "org_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "org_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
        ]
      }
      organization_capabilities: {
        Row: {
          capability: Database["platform"]["Enums"]["org_capability"]
          granted_at: string
          notes: string | null
          organization_id: string
        }
        Insert: {
          capability: Database["platform"]["Enums"]["org_capability"]
          granted_at?: string
          notes?: string | null
          organization_id: string
        }
        Update: {
          capability?: Database["platform"]["Enums"]["org_capability"]
          granted_at?: string
          notes?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_capabilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_capabilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_capabilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "organization_capabilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          is_active: boolean
          organization_id: string
          role: Database["platform"]["Enums"]["org_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id: string
          role?: Database["platform"]["Enums"]["org_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          role?: Database["platform"]["Enums"]["org_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "organization_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_product_agreements: {
        Row: {
          can_manage_tenants: boolean
          can_resell: boolean
          created_at: string
          default_deployment_mode: Database["platform"]["Enums"]["deployment_mode"]
          id: string
          margin_rate: number
          organization_id: string
          saas_product_id: string
          status: Database["platform"]["Enums"]["entity_status"]
          terms: Json
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          can_manage_tenants?: boolean
          can_resell?: boolean
          created_at?: string
          default_deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          id?: string
          margin_rate?: number
          organization_id: string
          saas_product_id: string
          status?: Database["platform"]["Enums"]["entity_status"]
          terms?: Json
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          can_manage_tenants?: boolean
          can_resell?: boolean
          created_at?: string
          default_deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          id?: string
          margin_rate?: number
          organization_id?: string
          saas_product_id?: string
          status?: Database["platform"]["Enums"]["entity_status"]
          terms?: Json
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_product_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_product_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_product_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "organization_product_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "organization_product_agreements_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_product_agreements_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "organization_product_agreements_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
        ]
      }
      organization_relationships: {
        Row: {
          child_organization_id: string
          created_at: string
          id: string
          notes: string | null
          parent_organization_id: string
          relationship_type: Database["platform"]["Enums"]["org_relationship_type"]
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          child_organization_id: string
          created_at?: string
          id?: string
          notes?: string | null
          parent_organization_id: string
          relationship_type: Database["platform"]["Enums"]["org_relationship_type"]
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          child_organization_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          parent_organization_id?: string
          relationship_type?: Database["platform"]["Enums"]["org_relationship_type"]
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_relationships_child_organization_id_fkey"
            columns: ["child_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_relationships_child_organization_id_fkey"
            columns: ["child_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_relationships_child_organization_id_fkey"
            columns: ["child_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "organization_relationships_child_organization_id_fkey"
            columns: ["child_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "organization_relationships_parent_organization_id_fkey"
            columns: ["parent_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_relationships_parent_organization_id_fkey"
            columns: ["parent_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_relationships_parent_organization_id_fkey"
            columns: ["parent_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "organization_relationships_parent_organization_id_fkey"
            columns: ["parent_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
        ]
      }
      organizations: {
        Row: {
          accent_color: string | null
          archived_at: string | null
          billing_email: string | null
          brand_slug: string | null
          country_code: string
          created_at: string
          display_name: string
          id: string
          kind: Database["platform"]["Enums"]["org_kind"]
          legal_name: string
          logo_url: string | null
          metadata: Json
          slug: string
          status: Database["platform"]["Enums"]["entity_status"]
          tax_id: string | null
          updated_at: string
          white_label: boolean
        }
        Insert: {
          accent_color?: string | null
          archived_at?: string | null
          billing_email?: string | null
          brand_slug?: string | null
          country_code?: string
          created_at?: string
          display_name: string
          id?: string
          kind?: Database["platform"]["Enums"]["org_kind"]
          legal_name: string
          logo_url?: string | null
          metadata?: Json
          slug: string
          status?: Database["platform"]["Enums"]["entity_status"]
          tax_id?: string | null
          updated_at?: string
          white_label?: boolean
        }
        Update: {
          accent_color?: string | null
          archived_at?: string | null
          billing_email?: string | null
          brand_slug?: string | null
          country_code?: string
          created_at?: string
          display_name?: string
          id?: string
          kind?: Database["platform"]["Enums"]["org_kind"]
          legal_name?: string
          logo_url?: string | null
          metadata?: Json
          slug?: string
          status?: Database["platform"]["Enums"]["entity_status"]
          tax_id?: string | null
          updated_at?: string
          white_label?: boolean
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          invoice_id: string
          method: string | null
          notes: string | null
          paid_at: string | null
          reference: string
          status: Database["platform"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          invoice_id: string
          method?: string | null
          notes?: string | null
          paid_at?: string | null
          reference: string
          status?: Database["platform"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          invoice_id?: string
          method?: string | null
          notes?: string | null
          paid_at?: string | null
          reference?: string
          status?: Database["platform"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_collected_revenue"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      plan_prices: {
        Row: {
          amount: number
          billing_interval: Database["platform"]["Enums"]["billing_interval"]
          charge_kind: Database["platform"]["Enums"]["charge_kind"]
          created_at: string
          currency: string
          id: string
          plan_id: string
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          amount: number
          billing_interval?: Database["platform"]["Enums"]["billing_interval"]
          charge_kind?: Database["platform"]["Enums"]["charge_kind"]
          created_at?: string
          currency?: string
          id?: string
          plan_id: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          amount?: number
          billing_interval?: Database["platform"]["Enums"]["billing_interval"]
          charge_kind?: Database["platform"]["Enums"]["charge_kind"]
          created_at?: string
          currency?: string
          id?: string
          plan_id?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_prices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string
          deployment_mode:
            | Database["platform"]["Enums"]["deployment_mode"]
            | null
          description: string | null
          id: string
          included_companies: number
          is_partner_base: boolean
          metadata: Json
          multi_country: boolean
          name: string
          saas_product_id: string
          sort_order: number
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          deployment_mode?:
            | Database["platform"]["Enums"]["deployment_mode"]
            | null
          description?: string | null
          id?: string
          included_companies?: number
          is_partner_base?: boolean
          metadata?: Json
          multi_country?: boolean
          name: string
          saas_product_id: string
          sort_order?: number
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          deployment_mode?:
            | Database["platform"]["Enums"]["deployment_mode"]
            | null
          description?: string | null
          id?: string
          included_companies?: number
          is_partner_base?: boolean
          metadata?: Json
          multi_country?: boolean
          name?: string
          saas_product_id?: string
          sort_order?: number
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "plans_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          granted_by: string | null
          is_active: boolean
          role: Database["platform"]["Enums"]["platform_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          is_active?: boolean
          role: Database["platform"]["Enums"]["platform_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          is_active?: boolean
          role?: Database["platform"]["Enums"]["platform_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_admins_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_defaults: {
        Row: {
          config: Json
          id: number
          updated_at: string
        }
        Insert: {
          config?: Json
          id?: number
          updated_at?: string
        }
        Update: {
          config?: Json
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          settings: Json
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          settings?: Json
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      provisioning_events: {
        Row: {
          detail: Json
          id: string
          message: string
          occurred_at: string
          provisioning_request_id: string
          status: Database["platform"]["Enums"]["provisioning_status"]
        }
        Insert: {
          detail?: Json
          id?: string
          message: string
          occurred_at?: string
          provisioning_request_id: string
          status: Database["platform"]["Enums"]["provisioning_status"]
        }
        Update: {
          detail?: Json
          id?: string
          message?: string
          occurred_at?: string
          provisioning_request_id?: string
          status?: Database["platform"]["Enums"]["provisioning_status"]
        }
        Relationships: [
          {
            foreignKeyName: "provisioning_events_provisioning_request_id_fkey"
            columns: ["provisioning_request_id"]
            isOneToOne: false
            referencedRelation: "provisioning_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      provisioning_requests: {
        Row: {
          action: Database["platform"]["Enums"]["provisioning_action"]
          attempts: number
          created_at: string
          deployment_target_id: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          max_attempts: number
          mode: string
          payload: Json
          requested_by: string | null
          result: Json
          saas_product_id: string | null
          started_at: string | null
          status: Database["platform"]["Enums"]["provisioning_status"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          action: Database["platform"]["Enums"]["provisioning_action"]
          attempts?: number
          created_at?: string
          deployment_target_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          max_attempts?: number
          mode?: string
          payload?: Json
          requested_by?: string | null
          result?: Json
          saas_product_id?: string | null
          started_at?: string | null
          status?: Database["platform"]["Enums"]["provisioning_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          action?: Database["platform"]["Enums"]["provisioning_action"]
          attempts?: number
          created_at?: string
          deployment_target_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          max_attempts?: number
          mode?: string
          payload?: Json
          requested_by?: string | null
          result?: Json
          saas_product_id?: string | null
          started_at?: string | null
          status?: Database["platform"]["Enums"]["provisioning_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provisioning_requests_deployment_target_id_fkey"
            columns: ["deployment_target_id"]
            isOneToOne: false
            referencedRelation: "deployment_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provisioning_requests_deployment_target_id_fkey"
            columns: ["deployment_target_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["deployment_target_id"]
          },
          {
            foreignKeyName: "provisioning_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provisioning_requests_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provisioning_requests_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "provisioning_requests_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "provisioning_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provisioning_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "provisioning_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      saas_products: {
        Row: {
          accent_color: string | null
          billing_unit: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_billable: boolean
          lockup_name: string | null
          metadata: Json
          name: string
          short_name: string
          sort_order: number
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          billing_unit?: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_billable?: boolean
          lockup_name?: string | null
          metadata?: Json
          name: string
          short_name: string
          sort_order?: number
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          billing_unit?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_billable?: boolean
          lockup_name?: string | null
          metadata?: Json
          name?: string
          short_name?: string
          sort_order?: number
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: []
      }
      sales_agents: {
        Row: {
          agent_type: Database["platform"]["Enums"]["sales_agent_type"]
          code: string
          contact_email: string | null
          created_at: string
          full_name: string
          id: string
          metadata: Json
          organization_id: string | null
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
          user_id: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          agent_type?: Database["platform"]["Enums"]["sales_agent_type"]
          code: string
          contact_email?: string | null
          created_at?: string
          full_name: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
          user_id?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          agent_type?: Database["platform"]["Enums"]["sales_agent_type"]
          code?: string
          contact_email?: string | null
          created_at?: string
          full_name?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
          user_id?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "sales_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "sales_agents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_attributions: {
        Row: {
          attribution_pct: number
          channel_organization_id: string | null
          commission_plan_id: string | null
          created_at: string
          customer_organization_id: string
          id: string
          notes: string | null
          saas_product_id: string
          sales_agent_id: string
          source: Database["platform"]["Enums"]["attribution_source"]
          status: Database["platform"]["Enums"]["entity_status"]
          subscription_id: string | null
          tenant_id: string | null
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          attribution_pct?: number
          channel_organization_id?: string | null
          commission_plan_id?: string | null
          created_at?: string
          customer_organization_id: string
          id?: string
          notes?: string | null
          saas_product_id: string
          sales_agent_id: string
          source?: Database["platform"]["Enums"]["attribution_source"]
          status?: Database["platform"]["Enums"]["entity_status"]
          subscription_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          attribution_pct?: number
          channel_organization_id?: string | null
          commission_plan_id?: string | null
          created_at?: string
          customer_organization_id?: string
          id?: string
          notes?: string | null
          saas_product_id?: string
          sales_agent_id?: string
          source?: Database["platform"]["Enums"]["attribution_source"]
          status?: Database["platform"]["Enums"]["entity_status"]
          subscription_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_attr_commission_plan_fk"
            columns: ["commission_plan_id"]
            isOneToOne: false
            referencedRelation: "commission_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_attributions_channel_organization_id_fkey"
            columns: ["channel_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_attributions_channel_organization_id_fkey"
            columns: ["channel_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_attributions_channel_organization_id_fkey"
            columns: ["channel_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "sales_attributions_channel_organization_id_fkey"
            columns: ["channel_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "sales_attributions_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_attributions_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_attributions_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "sales_attributions_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "sales_attributions_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_attributions_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "sales_attributions_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "sales_attributions_sales_agent_id_fkey"
            columns: ["sales_agent_id"]
            isOneToOne: false
            referencedRelation: "sales_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_attributions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_attributions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_mrr"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "sales_attributions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "sales_attributions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_attributions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "sales_attributions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      subscription_items: {
        Row: {
          amount: number | null
          billing_interval: Database["platform"]["Enums"]["billing_interval"]
          catalog_item_code: string | null
          charge_kind: Database["platform"]["Enums"]["charge_kind"]
          created_at: string
          currency: string
          description: string
          id: string
          quantity: number
          subscription_id: string
          tenant_id: string | null
          unit_amount: number
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          amount?: number | null
          billing_interval?: Database["platform"]["Enums"]["billing_interval"]
          catalog_item_code?: string | null
          charge_kind: Database["platform"]["Enums"]["charge_kind"]
          created_at?: string
          currency?: string
          description: string
          id?: string
          quantity?: number
          subscription_id: string
          tenant_id?: string | null
          unit_amount: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          amount?: number | null
          billing_interval?: Database["platform"]["Enums"]["billing_interval"]
          catalog_item_code?: string | null
          charge_kind?: Database["platform"]["Enums"]["charge_kind"]
          created_at?: string
          currency?: string
          description?: string
          id?: string
          quantity?: number
          subscription_id?: string
          tenant_id?: string | null
          unit_amount?: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_items_catalog_item_code_fkey"
            columns: ["catalog_item_code"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "subscription_items_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_items_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_mrr"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_items_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "subscription_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billed_organization_id: string
          billing_interval: Database["platform"]["Enums"]["billing_interval"]
          cancelled_at: string | null
          channel_margin_rate: number | null
          code: string
          created_at: string
          currency: string
          ends_on: string | null
          id: string
          metadata: Json
          notes: string | null
          plan_id: string
          quantity: number
          saas_product_id: string
          started_on: string
          status: Database["platform"]["Enums"]["subscription_status"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          billed_organization_id: string
          billing_interval?: Database["platform"]["Enums"]["billing_interval"]
          cancelled_at?: string | null
          channel_margin_rate?: number | null
          code: string
          created_at?: string
          currency?: string
          ends_on?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          plan_id: string
          quantity?: number
          saas_product_id: string
          started_on?: string
          status?: Database["platform"]["Enums"]["subscription_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          billed_organization_id?: string
          billing_interval?: Database["platform"]["Enums"]["billing_interval"]
          cancelled_at?: string | null
          channel_margin_rate?: number | null
          code?: string
          created_at?: string
          currency?: string
          ends_on?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          plan_id?: string
          quantity?: number
          saas_product_id?: string
          started_on?: string
          status?: Database["platform"]["Enums"]["subscription_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "subscriptions_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      tenant_addons: {
        Row: {
          activated_at: string
          active: boolean
          addon_code: string
          created_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string
          active?: boolean
          addon_code: string
          created_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string
          active?: boolean
          addon_code?: string
          created_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_addons_addon_code_fkey"
            columns: ["addon_code"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "tenant_addons_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_addons_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_addons_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      tenant_deployments: {
        Row: {
          created_at: string
          deployed_at: string | null
          deployment_target_id: string
          id: string
          is_primary: boolean
          notes: string | null
          status: Database["platform"]["Enums"]["entity_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deployed_at?: string | null
          deployment_target_id: string
          id?: string
          is_primary?: boolean
          notes?: string | null
          status?: Database["platform"]["Enums"]["entity_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deployed_at?: string | null
          deployment_target_id?: string
          id?: string
          is_primary?: boolean
          notes?: string | null
          status?: Database["platform"]["Enums"]["entity_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_deployments_deployment_target_id_fkey"
            columns: ["deployment_target_id"]
            isOneToOne: false
            referencedRelation: "deployment_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_deployments_deployment_target_id_fkey"
            columns: ["deployment_target_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["deployment_target_id"]
          },
          {
            foreignKeyName: "tenant_deployments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_deployments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_deployments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      tenant_features: {
        Row: {
          created_at: string
          enabled: boolean
          feature_key: string
          source: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          feature_key: string
          source?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          created_at?: string
          enabled?: boolean
          feature_key?: string
          source?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "tenant_features_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_features_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_features_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_features_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          role: Database["platform"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          role?: Database["platform"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          role?: Database["platform"]["Enums"]["tenant_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          config: Json
          created_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      tenants: {
        Row: {
          accent_color: string | null
          activated_at: string | null
          admin_activated_at: string | null
          admin_email: string
          churned_at: string | null
          company_id: string | null
          created_at: string
          customer_organization_id: string
          deployment_mode: Database["platform"]["Enums"]["deployment_mode"]
          environment: Database["platform"]["Enums"]["environment_kind"]
          id: string
          logo_url: string | null
          managing_organization_id: string | null
          metadata: Json
          name: string
          saas_product_id: string
          slug: string
          status: Database["platform"]["Enums"]["tenant_status"]
          tenant_type: Database["platform"]["Enums"]["tenant_type"]
          updated_at: string
          white_label: boolean
        }
        Insert: {
          accent_color?: string | null
          activated_at?: string | null
          admin_activated_at?: string | null
          admin_email: string
          churned_at?: string | null
          company_id?: string | null
          created_at?: string
          customer_organization_id: string
          deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          environment?: Database["platform"]["Enums"]["environment_kind"]
          id?: string
          logo_url?: string | null
          managing_organization_id?: string | null
          metadata?: Json
          name: string
          saas_product_id: string
          slug: string
          status?: Database["platform"]["Enums"]["tenant_status"]
          tenant_type?: Database["platform"]["Enums"]["tenant_type"]
          updated_at?: string
          white_label?: boolean
        }
        Update: {
          accent_color?: string | null
          activated_at?: string | null
          admin_activated_at?: string | null
          admin_email?: string
          churned_at?: string | null
          company_id?: string | null
          created_at?: string
          customer_organization_id?: string
          deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          environment?: Database["platform"]["Enums"]["environment_kind"]
          id?: string
          logo_url?: string | null
          managing_organization_id?: string | null
          metadata?: Json
          name?: string
          saas_product_id?: string
          slug?: string
          status?: Database["platform"]["Enums"]["tenant_status"]
          tenant_type?: Database["platform"]["Enums"]["tenant_type"]
          updated_at?: string
          white_label?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tenants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenants_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenants_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenants_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "tenants_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "tenants_managing_organization_id_fkey"
            columns: ["managing_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenants_managing_organization_id_fkey"
            columns: ["managing_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenants_managing_organization_id_fkey"
            columns: ["managing_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "tenants_managing_organization_id_fkey"
            columns: ["managing_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "tenants_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenants_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "tenants_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
        ]
      }
      workspace_apps: {
        Row: {
          activated_at: string | null
          created_at: string
          organization_id: string
          saas_product_id: string
          status: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          organization_id: string
          saas_product_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          organization_id?: string
          saas_product_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_apps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_apps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "workspace_apps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "workspace_apps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "workspace_apps_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_apps_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "workspace_apps_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
        ]
      }
    }
    Views: {
      v_collected_revenue: {
        Row: {
          charge_kind: Database["platform"]["Enums"]["charge_kind"] | null
          collected_amount: number | null
          collected_on: string | null
          currency: string | null
          customer_organization_id: string | null
          invoice_id: string | null
          is_recurring: boolean | null
          period_end: string | null
          period_start: string | null
          saas_product_id: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "invoice_lines_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "invoice_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "invoice_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "invoices_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "invoices_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "invoices_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
        ]
      }
      v_partner_margin: {
        Row: {
          collected_revenue: number | null
          commission_total: number | null
          currency: string | null
          direct_cost: number | null
          display_name: string | null
          gross_margin: number | null
          managed_tenants: number | null
          mrr: number | null
          organization_id: string | null
        }
        Relationships: []
      }
      v_product_margin: {
        Row: {
          arr: number | null
          collected_one_time: number | null
          collected_recurring: number | null
          collected_revenue: number | null
          commission_paid: number | null
          commission_pending: number | null
          commission_total: number | null
          currency: string | null
          direct_cost: number | null
          gross_margin: number | null
          mrr: number | null
          product_code: string | null
          saas_product_id: string | null
          short_name: string | null
        }
        Relationships: []
      }
      v_subscription_mrr: {
        Row: {
          billed_organization_id: string | null
          currency: string | null
          deployment_mode:
            | Database["platform"]["Enums"]["deployment_mode"]
            | null
          managing_organization_id: string | null
          mrr: number | null
          saas_product_id: string | null
          subscription_id: string | null
          tenant_id: string | null
          tenant_type: Database["platform"]["Enums"]["tenant_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "subscriptions_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "saas_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_margin"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "subscriptions_saas_product_id_fkey"
            columns: ["saas_product_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["saas_product_id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_margin"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenants_managing_organization_id_fkey"
            columns: ["managing_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenants_managing_organization_id_fkey"
            columns: ["managing_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenants_managing_organization_id_fkey"
            columns: ["managing_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "tenants_managing_organization_id_fkey"
            columns: ["managing_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
        ]
      }
      v_tenant_costs: {
        Row: {
          allocation_path: string | null
          category: Database["platform"]["Enums"]["cost_category"] | null
          cost_amount: number | null
          currency: string | null
          period_end: string | null
          period_start: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      v_tenant_margin: {
        Row: {
          collected_revenue: number | null
          commission_total: number | null
          currency: string | null
          deployment_mode:
            | Database["platform"]["Enums"]["deployment_mode"]
            | null
          direct_cost: number | null
          gross_margin: number | null
          mrr: number | null
          name: string | null
          product_code: string | null
          slug: string | null
          tenant_id: string | null
          tenant_type: Database["platform"]["Enums"]["tenant_type"] | null
        }
        Relationships: []
      }
      v_tenant_overview: {
        Row: {
          activated_at: string | null
          admin_activated_at: string | null
          admin_email: string | null
          created_at: string | null
          currency: string | null
          customer_name: string | null
          customer_organization_id: string | null
          deployment_mode:
            | Database["platform"]["Enums"]["deployment_mode"]
            | null
          deployment_provider:
            | Database["platform"]["Enums"]["infra_provider"]
            | null
          deployment_region: string | null
          deployment_target_code: string | null
          deployment_target_id: string | null
          environment: Database["platform"]["Enums"]["environment_kind"] | null
          managing_name: string | null
          managing_organization_id: string | null
          mrr: number | null
          name: string | null
          plan_name: string | null
          product_code: string | null
          product_lockup: string | null
          product_short_name: string | null
          saas_product_id: string | null
          slug: string | null
          status: Database["platform"]["Enums"]["tenant_status"] | null
          subscription_id: string | null
          tenant_id: string | null
          tenant_type: Database["platform"]["Enums"]["tenant_type"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_manage_platform_entities: { Args: never; Returns: boolean }
      can_manage_tenant: { Args: { p_tenant: string }; Returns: boolean }
      can_read_finance: { Args: never; Returns: boolean }
      can_read_tenant: { Args: { p_tenant: string }; Returns: boolean }
      create_tenant: {
        Args: {
          p_admin_email: string
          p_company_id?: string
          p_customer_organization_id: string
          p_deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          p_managing_organization_id?: string
          p_metadata?: Json
          p_name: string
          p_saas_product_code: string
          p_slug: string
          p_tenant_type?: Database["platform"]["Enums"]["tenant_type"]
        }
        Returns: string
      }
      dashboard_summary: { Args: never; Returns: Json }
      effective_config: { Args: { p_company: string }; Returns: Json }
      effective_tenant_config: { Args: { p_tenant: string }; Returns: Json }
      generate_commission_events: {
        Args: { p_payment_id: string }
        Returns: number
      }
      has_org_commercial_access: { Args: { p_org: string }; Returns: boolean }
      has_platform_role: {
        Args: { p_role: Database["platform"]["Enums"]["platform_role"] }
        Returns: boolean
      }
      is_org_admin: { Args: { p_org: string }; Returns: boolean }
      is_org_member: { Args: { p_org: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_sales_agent: { Args: never; Returns: boolean }
      is_slug: { Args: { p_value: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      jsonb_deep_merge: { Args: { a: Json; b: Json }; Returns: Json }
      log_audit: {
        Args: {
          p_action: string
          p_entity_id?: string
          p_entity_type: string
          p_metadata?: Json
          p_organization_id?: string
          p_tenant_id?: string
        }
        Returns: number
      }
      my_attributed_org_ids: { Args: never; Returns: string[] }
      my_attributed_tenant_ids: { Args: never; Returns: string[] }
      my_direct_tenant_ids: { Args: never; Returns: string[] }
      my_org_ids: { Args: never; Returns: string[] }
      my_sales_agent_ids: { Args: never; Returns: string[] }
      my_tenant_ids: { Args: never; Returns: string[] }
      settle_commissions: {
        Args: {
          p_currency?: string
          p_period_end: string
          p_period_start: string
          p_sales_agent_id: string
        }
        Returns: string
      }
    }
    Enums: {
      attribution_source:
        | "DIRECT"
        | "PARTNER"
        | "REFERRAL"
        | "INBOUND"
        | "CAMPAIGN"
      billing_interval: "MONTHLY" | "QUARTERLY" | "YEARLY" | "ONE_TIME"
      charge_kind:
        | "LICENSE"
        | "PARTNER_BASE_LICENSE"
        | "TENANT_LICENSE"
        | "IMPLEMENTATION_FEE"
        | "INFRASTRUCTURE_FEE"
        | "SUPPORT_FEE"
        | "ADDON"
        | "PROFESSIONAL_SERVICES"
        | "DISCOUNT"
      commission_basis:
        | "COLLECTED_LICENSE"
        | "COLLECTED_IMPLEMENTATION"
        | "COLLECTED_ANY"
        | "FIXED_AMOUNT"
      commission_status: "PENDING" | "ELIGIBLE" | "ACCRUED" | "PAID" | "VOID"
      cost_category:
        | "DATABASE"
        | "COMPUTE"
        | "STORAGE"
        | "BANDWIDTH"
        | "MESSAGING"
        | "FRONTEND_HOSTING"
        | "DOMAIN"
        | "SUPPORT"
        | "DEDICATED_INFRA"
        | "THIRD_PARTY"
        | "ADMIN_MANUAL"
      cost_scope:
        | "PLATFORM"
        | "PRODUCT"
        | "ORGANIZATION"
        | "TENANT"
        | "DEPLOYMENT_TARGET"
      deployment_mode: "SHARED" | "PARTNER_DEDICATED" | "TENANT_DEDICATED"
      entity_status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "ARCHIVED"
      environment_kind: "DEMO" | "TRIAL" | "PRODUCTION" | "SANDBOX"
      infra_provider: "SUPABASE" | "AWS" | "AZURE" | "GCP" | "ON_PREMISE"
      invoice_status:
        | "DRAFT"
        | "ISSUED"
        | "PARTIALLY_PAID"
        | "PAID"
        | "VOID"
        | "UNCOLLECTIBLE"
      org_capability: "PARTNER" | "RESELLER" | "CONSULTING" | "CUSTOMER"
      org_kind: "PLATFORM" | "COMPANY"
      org_relationship_type: "MANAGES" | "RESELLS_TO" | "SUBCONTRACTS"
      org_role:
        | "PARTNER_ADMIN"
        | "PARTNER_SALES"
        | "PARTNER_SUPPORT"
        | "ORG_ADMIN"
        | "ORG_VIEWER"
      payment_status: "PENDING" | "CONFIRMED" | "REVERSED"
      platform_role: "EBIM_SUPER_ADMIN" | "EBIM_PRODUCT_ADMIN" | "EBIM_FINANCE"
      provisioning_action:
        | "CREATE_TENANT_SPACE"
        | "CREATE_DEDICATED_TARGET"
        | "ATTACH_TENANT_TO_TARGET"
        | "SUSPEND_TENANT"
        | "RESUME_TENANT"
        | "DECOMMISSION_TENANT"
      provisioning_status:
        | "PENDING"
        | "VALIDATING"
        | "RUNNING"
        | "SUCCEEDED"
        | "FAILED"
        | "CANCELLED"
      sales_agent_type: "EBIM_INTERNAL" | "INDEPENDENT" | "PARTNER_AGENT"
      settlement_status: "OPEN" | "APPROVED" | "PAID" | "CANCELLED"
      subscription_status:
        | "DRAFT"
        | "ACTIVE"
        | "PAST_DUE"
        | "PAUSED"
        | "CANCELLED"
      tenant_role: "TENANT_ADMIN" | "TENANT_USER"
      tenant_status: "PENDING" | "ACTIVE" | "SUSPENDED" | "CHURNED" | "ARCHIVED"
      tenant_type: "DEMO" | "TRIAL" | "PRODUCTION" | "SANDBOX"
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
  platform: {
    Enums: {
      attribution_source: [
        "DIRECT",
        "PARTNER",
        "REFERRAL",
        "INBOUND",
        "CAMPAIGN",
      ],
      billing_interval: ["MONTHLY", "QUARTERLY", "YEARLY", "ONE_TIME"],
      charge_kind: [
        "LICENSE",
        "PARTNER_BASE_LICENSE",
        "TENANT_LICENSE",
        "IMPLEMENTATION_FEE",
        "INFRASTRUCTURE_FEE",
        "SUPPORT_FEE",
        "ADDON",
        "PROFESSIONAL_SERVICES",
        "DISCOUNT",
      ],
      commission_basis: [
        "COLLECTED_LICENSE",
        "COLLECTED_IMPLEMENTATION",
        "COLLECTED_ANY",
        "FIXED_AMOUNT",
      ],
      commission_status: ["PENDING", "ELIGIBLE", "ACCRUED", "PAID", "VOID"],
      cost_category: [
        "DATABASE",
        "COMPUTE",
        "STORAGE",
        "BANDWIDTH",
        "MESSAGING",
        "FRONTEND_HOSTING",
        "DOMAIN",
        "SUPPORT",
        "DEDICATED_INFRA",
        "THIRD_PARTY",
        "ADMIN_MANUAL",
      ],
      cost_scope: [
        "PLATFORM",
        "PRODUCT",
        "ORGANIZATION",
        "TENANT",
        "DEPLOYMENT_TARGET",
      ],
      deployment_mode: ["SHARED", "PARTNER_DEDICATED", "TENANT_DEDICATED"],
      entity_status: ["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"],
      environment_kind: ["DEMO", "TRIAL", "PRODUCTION", "SANDBOX"],
      infra_provider: ["SUPABASE", "AWS", "AZURE", "GCP", "ON_PREMISE"],
      invoice_status: [
        "DRAFT",
        "ISSUED",
        "PARTIALLY_PAID",
        "PAID",
        "VOID",
        "UNCOLLECTIBLE",
      ],
      org_capability: ["PARTNER", "RESELLER", "CONSULTING", "CUSTOMER"],
      org_kind: ["PLATFORM", "COMPANY"],
      org_relationship_type: ["MANAGES", "RESELLS_TO", "SUBCONTRACTS"],
      org_role: [
        "PARTNER_ADMIN",
        "PARTNER_SALES",
        "PARTNER_SUPPORT",
        "ORG_ADMIN",
        "ORG_VIEWER",
      ],
      payment_status: ["PENDING", "CONFIRMED", "REVERSED"],
      platform_role: ["EBIM_SUPER_ADMIN", "EBIM_PRODUCT_ADMIN", "EBIM_FINANCE"],
      provisioning_action: [
        "CREATE_TENANT_SPACE",
        "CREATE_DEDICATED_TARGET",
        "ATTACH_TENANT_TO_TARGET",
        "SUSPEND_TENANT",
        "RESUME_TENANT",
        "DECOMMISSION_TENANT",
      ],
      provisioning_status: [
        "PENDING",
        "VALIDATING",
        "RUNNING",
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
      ],
      sales_agent_type: ["EBIM_INTERNAL", "INDEPENDENT", "PARTNER_AGENT"],
      settlement_status: ["OPEN", "APPROVED", "PAID", "CANCELLED"],
      subscription_status: [
        "DRAFT",
        "ACTIVE",
        "PAST_DUE",
        "PAUSED",
        "CANCELLED",
      ],
      tenant_role: ["TENANT_ADMIN", "TENANT_USER"],
      tenant_status: ["PENDING", "ACTIVE", "SUSPENDED", "CHURNED", "ARCHIVED"],
      tenant_type: ["DEMO", "TRIAL", "PRODUCTION", "SANDBOX"],
    },
  },
} as const

