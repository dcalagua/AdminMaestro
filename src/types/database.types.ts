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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
      billing_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_type: Database["platform"]["Enums"]["billing_alert_type"]
          created_at: string
          dedupe_key: string
          document_id: string | null
          due_at: string
          id: string
          invoice_id: string | null
          message: string | null
          metadata: Json
          reference_date: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: Database["platform"]["Enums"]["billing_alert_status"]
          subscription_id: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          alert_type: Database["platform"]["Enums"]["billing_alert_type"]
          created_at?: string
          dedupe_key: string
          document_id?: string | null
          due_at: string
          id?: string
          invoice_id?: string | null
          message?: string | null
          metadata?: Json
          reference_date?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: Database["platform"]["Enums"]["billing_alert_status"]
          subscription_id: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          alert_type?: Database["platform"]["Enums"]["billing_alert_type"]
          created_at?: string
          dedupe_key?: string
          document_id?: string | null
          due_at?: string
          id?: string
          invoice_id?: string | null
          message?: string | null
          metadata?: Json
          reference_date?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: Database["platform"]["Enums"]["billing_alert_status"]
          subscription_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_alerts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "subscription_commercial_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_alerts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_documents"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "billing_alerts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_alerts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_collected_revenue"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "billing_alerts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_commission_detail"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "billing_alerts_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_alerts_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_renewal_dashboard"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "billing_alerts_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_collection"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "billing_alerts_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_documents"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "billing_alerts_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_mrr"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "billing_alerts_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["subscription_id"]
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
          currency: string
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
            foreignKeyName: "catalog_items_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
          reversal_of_event_id: string | null
          reversal_reason: string | null
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
          currency: string
          earned_on: string
          id?: string
          invoice_line_id?: string | null
          payment_id: string
          reversal_of_event_id?: string | null
          reversal_reason?: string | null
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
          reversal_of_event_id?: string | null
          reversal_reason?: string | null
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
            foreignKeyName: "commission_events_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
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
            foreignKeyName: "commission_events_reversal_of_event_id_fkey"
            columns: ["reversal_of_event_id"]
            isOneToOne: false
            referencedRelation: "commission_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_reversal_of_event_id_fkey"
            columns: ["reversal_of_event_id"]
            isOneToOne: false
            referencedRelation: "v_commission_detail"
            referencedColumns: ["commission_event_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
          currency: string
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
          {
            foreignKeyName: "commission_rules_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
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
          currency: string
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
            foreignKeyName: "commission_settlements_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
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
          market_id: string | null
          name: string
          organization_id: string
          status: Database["platform"]["Enums"]["entity_status"]
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          country_code: string
          created_at?: string
          currency: string
          erp_code?: string | null
          id?: string
          is_default?: boolean
          market_id?: string | null
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
          market_id?: string | null
          name?: string
          organization_id?: string
          status?: Database["platform"]["Enums"]["entity_status"]
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "companies_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
          {
            foreignKeyName: "company_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "v_company_markets"
            referencedColumns: ["company_id"]
          },
        ]
      }
      control_plane_settings: {
        Row: {
          created_at: string
          fx_max_rate_age_days: number
          id: boolean
          reporting_currency_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          fx_max_rate_age_days?: number
          id?: boolean
          reporting_currency_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          fx_max_rate_age_days?: number
          id?: boolean
          reporting_currency_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "control_plane_settings_reporting_currency_code_fkey"
            columns: ["reporting_currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "control_plane_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "cost_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
          currency: string
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
        Relationships: [
          {
            foreignKeyName: "cost_entries_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          decimals: number
          name: string
          status: Database["platform"]["Enums"]["entity_status"]
          symbol: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          decimals: number
          name: string
          status?: Database["platform"]["Enums"]["entity_status"]
          symbol?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          decimals?: number
          name?: string
          status?: Database["platform"]["Enums"]["entity_status"]
          symbol?: string | null
          updated_at?: string
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "deployment_targets_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
      exchange_rates: {
        Row: {
          base_currency: string
          created_at: string
          created_by: string | null
          id: string
          is_demo: boolean
          notes: string | null
          quote_currency: string
          rate: number
          rate_date: string
          source: Database["platform"]["Enums"]["fx_rate_source"]
          status: Database["platform"]["Enums"]["fx_rate_status"]
          status_changed_at: string | null
          status_changed_by: string | null
          status_reason: string | null
          superseded_by: string | null
          updated_at: string
        }
        Insert: {
          base_currency: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          quote_currency: string
          rate: number
          rate_date: string
          source?: Database["platform"]["Enums"]["fx_rate_source"]
          status?: Database["platform"]["Enums"]["fx_rate_status"]
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_reason?: string | null
          superseded_by?: string | null
          updated_at?: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          quote_currency?: string
          rate?: number
          rate_date?: string
          source?: Database["platform"]["Enums"]["fx_rate_source"]
          status?: Database["platform"]["Enums"]["fx_rate_status"]
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_reason?: string | null
          superseded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_rates_base_currency_fkey"
            columns: ["base_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exchange_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_rates_quote_currency_fkey"
            columns: ["quote_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exchange_rates_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_rates_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "exchange_rates"
            referencedColumns: ["id"]
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
          currency: string
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
            foreignKeyName: "invoice_lines_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
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
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_commission_detail"
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
          currency: string
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
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_company_markets"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "invoices_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "invoices_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_renewal_dashboard"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_collection"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_documents"
            referencedColumns: ["subscription_id"]
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
      market_currencies: {
        Row: {
          created_at: string
          currency_code: string
          market_id: string
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency_code: string
          market_id: string
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency_code?: string
          market_id?: string
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_currencies_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "market_currencies_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          code: string
          country_code: string
          created_at: string
          default_currency_code: string
          id: string
          name: string
          sort_order: number
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          code: string
          country_code: string
          created_at?: string
          default_currency_code: string
          id?: string
          name: string
          sort_order?: number
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          country_code?: string
          created_at?: string
          default_currency_code?: string
          id?: string
          name?: string
          sort_order?: number
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "markets_default_currency_code_fkey"
            columns: ["default_currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "org_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_capabilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            foreignKeyName: "organization_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_company_markets"
            referencedColumns: ["company_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
          allowed_deployment_modes: Database["platform"]["Enums"]["deployment_mode"][]
          allowed_tenant_types: Database["platform"]["Enums"]["tenant_type"][]
          billing_responsibility: Database["platform"]["Enums"]["billing_responsibility"]
          can_manage_tenants: boolean
          can_resell: boolean
          created_at: string
          default_deployment_mode: Database["platform"]["Enums"]["deployment_mode"]
          id: string
          margin_rate: number
          max_tenants: number | null
          notes: string | null
          organization_id: string
          saas_product_id: string
          status: Database["platform"]["Enums"]["entity_status"]
          terms: Json
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          allowed_deployment_modes?: Database["platform"]["Enums"]["deployment_mode"][]
          allowed_tenant_types?: Database["platform"]["Enums"]["tenant_type"][]
          billing_responsibility?: Database["platform"]["Enums"]["billing_responsibility"]
          can_manage_tenants?: boolean
          can_resell?: boolean
          created_at?: string
          default_deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          id?: string
          margin_rate?: number
          max_tenants?: number | null
          notes?: string | null
          organization_id: string
          saas_product_id: string
          status?: Database["platform"]["Enums"]["entity_status"]
          terms?: Json
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          allowed_deployment_modes?: Database["platform"]["Enums"]["deployment_mode"][]
          allowed_tenant_types?: Database["platform"]["Enums"]["tenant_type"][]
          billing_responsibility?: Database["platform"]["Enums"]["billing_responsibility"]
          can_manage_tenants?: boolean
          can_resell?: boolean
          created_at?: string
          default_deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          id?: string
          margin_rate?: number
          max_tenants?: number | null
          notes?: string | null
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_product_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_relationships_child_organization_id_fkey"
            columns: ["child_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_relationships_parent_organization_id_fkey"
            columns: ["parent_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
          billing_address: string | null
          billing_city: string | null
          billing_email: string | null
          billing_first_name: string | null
          billing_last_name: string | null
          billing_phone: string | null
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
          billing_address?: string | null
          billing_city?: string | null
          billing_email?: string | null
          billing_first_name?: string | null
          billing_last_name?: string | null
          billing_phone?: string | null
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
          billing_address?: string | null
          billing_city?: string | null
          billing_email?: string | null
          billing_first_name?: string | null
          billing_last_name?: string | null
          billing_phone?: string | null
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
      payment_provider_account_currencies: {
        Row: {
          created_at: string
          currency_code: string
          provider_account_id: string
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency_code: string
          provider_account_id: string
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency_code?: string
          provider_account_id?: string
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_provider_account_currencies_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payment_provider_account_currencies_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_account_currencies_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "v_provider_account_routes"
            referencedColumns: ["provider_account_id"]
          },
        ]
      }
      payment_provider_accounts: {
        Row: {
          code: string
          country_code: string
          created_at: string
          currency: string
          environment: Database["platform"]["Enums"]["provider_environment"]
          id: string
          market_id: string | null
          metadata: Json
          name: string
          owner_organization_id: string | null
          provider_kind: Database["platform"]["Enums"]["provider_kind"]
          public_key: string | null
          routing_priority: number
          rsa_id_ref: string | null
          rsa_public_key_ref: string | null
          secret_key_ref: string | null
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
          webhook_endpoint: string | null
        }
        Insert: {
          code: string
          country_code: string
          created_at?: string
          currency: string
          environment?: Database["platform"]["Enums"]["provider_environment"]
          id?: string
          market_id?: string | null
          metadata?: Json
          name: string
          owner_organization_id?: string | null
          provider_kind: Database["platform"]["Enums"]["provider_kind"]
          public_key?: string | null
          routing_priority?: number
          rsa_id_ref?: string | null
          rsa_public_key_ref?: string | null
          secret_key_ref?: string | null
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
          webhook_endpoint?: string | null
        }
        Update: {
          code?: string
          country_code?: string
          created_at?: string
          currency?: string
          environment?: Database["platform"]["Enums"]["provider_environment"]
          id?: string
          market_id?: string | null
          metadata?: Json
          name?: string
          owner_organization_id?: string | null
          provider_kind?: Database["platform"]["Enums"]["provider_kind"]
          public_key?: string | null
          routing_priority?: number
          rsa_id_ref?: string | null
          rsa_public_key_ref?: string | null
          secret_key_ref?: string | null
          status?: Database["platform"]["Enums"]["entity_status"]
          updated_at?: string
          webhook_endpoint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_provider_accounts_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payment_provider_accounts_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
        ]
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
          currency: string
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
            foreignKeyName: "payments_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
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
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_commission_detail"
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
          market_id: string | null
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
          currency: string
          id?: string
          market_id?: string | null
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
          market_id?: string | null
          plan_id?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_prices_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "plan_prices_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
      provider_customers: {
        Row: {
          created_at: string
          external_customer_id: string
          id: string
          metadata: Json
          organization_id: string
          provider_account_id: string
          status: Database["platform"]["Enums"]["provider_mapping_status"]
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_customer_id: string
          id?: string
          metadata?: Json
          organization_id: string
          provider_account_id: string
          status?: Database["platform"]["Enums"]["provider_mapping_status"]
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_customer_id?: string
          id?: string
          metadata?: Json
          organization_id?: string
          provider_account_id?: string
          status?: Database["platform"]["Enums"]["provider_mapping_status"]
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "provider_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "provider_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "provider_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "provider_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "provider_customers_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_customers_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "v_provider_account_routes"
            referencedColumns: ["provider_account_id"]
          },
        ]
      }
      provider_payment_methods: {
        Row: {
          brand: string | null
          created_at: string
          exp_month: number | null
          exp_year: number | null
          external_payment_method_id: string
          id: string
          is_default: boolean
          last4: string | null
          metadata: Json
          organization_id: string
          provider_account_id: string
          provider_customer_id: string | null
          status: Database["platform"]["Enums"]["provider_mapping_status"]
          synced_at: string
          updated_at: string
        }
        Insert: {
          brand?: string | null
          created_at?: string
          exp_month?: number | null
          exp_year?: number | null
          external_payment_method_id: string
          id?: string
          is_default?: boolean
          last4?: string | null
          metadata?: Json
          organization_id: string
          provider_account_id: string
          provider_customer_id?: string | null
          status?: Database["platform"]["Enums"]["provider_mapping_status"]
          synced_at?: string
          updated_at?: string
        }
        Update: {
          brand?: string | null
          created_at?: string
          exp_month?: number | null
          exp_year?: number | null
          external_payment_method_id?: string
          id?: string
          is_default?: boolean
          last4?: string | null
          metadata?: Json
          organization_id?: string
          provider_account_id?: string
          provider_customer_id?: string | null
          status?: Database["platform"]["Enums"]["provider_mapping_status"]
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "provider_payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "provider_payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "provider_payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "provider_payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
          {
            foreignKeyName: "provider_payment_methods_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_payment_methods_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "v_provider_account_routes"
            referencedColumns: ["provider_account_id"]
          },
          {
            foreignKeyName: "provider_payment_methods_provider_customer_id_fkey"
            columns: ["provider_customer_id"]
            isOneToOne: false
            referencedRelation: "provider_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_plans: {
        Row: {
          amount: number
          billing_interval: Database["platform"]["Enums"]["billing_interval"]
          created_at: string
          currency: string
          external_plan_id: string
          id: string
          metadata: Json
          plan_id: string
          provider_account_id: string
          status: Database["platform"]["Enums"]["provider_mapping_status"]
          synced_at: string
          updated_at: string
        }
        Insert: {
          amount: number
          billing_interval: Database["platform"]["Enums"]["billing_interval"]
          created_at?: string
          currency: string
          external_plan_id: string
          id?: string
          metadata?: Json
          plan_id: string
          provider_account_id: string
          status?: Database["platform"]["Enums"]["provider_mapping_status"]
          synced_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          billing_interval?: Database["platform"]["Enums"]["billing_interval"]
          created_at?: string
          currency?: string
          external_plan_id?: string
          id?: string
          metadata?: Json
          plan_id?: string
          provider_account_id?: string
          status?: Database["platform"]["Enums"]["provider_mapping_status"]
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_plans_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "provider_plans_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_plans_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_plans_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "v_provider_account_routes"
            referencedColumns: ["provider_account_id"]
          },
        ]
      }
      provider_subscriptions: {
        Row: {
          created_at: string
          external_customer_id: string | null
          external_payment_method_id: string | null
          external_plan_id: string | null
          external_subscription_id: string
          id: string
          last_error_code: string | null
          last_error_message: string | null
          metadata: Json
          next_billing_at: string | null
          provider_account_id: string
          provider_status: string
          status: Database["platform"]["Enums"]["provider_mapping_status"]
          subscription_id: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_customer_id?: string | null
          external_payment_method_id?: string | null
          external_plan_id?: string | null
          external_subscription_id: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          metadata?: Json
          next_billing_at?: string | null
          provider_account_id: string
          provider_status?: string
          status?: Database["platform"]["Enums"]["provider_mapping_status"]
          subscription_id: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_customer_id?: string | null
          external_payment_method_id?: string | null
          external_plan_id?: string | null
          external_subscription_id?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          metadata?: Json
          next_billing_at?: string | null
          provider_account_id?: string
          provider_status?: string
          status?: Database["platform"]["Enums"]["provider_mapping_status"]
          subscription_id?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_subscriptions_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_subscriptions_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "v_provider_account_routes"
            referencedColumns: ["provider_account_id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_renewal_dashboard"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_collection"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_documents"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_mrr"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["subscription_id"]
          },
        ]
      }
      provider_webhook_events: {
        Row: {
          error_code: string | null
          error_message: string | null
          event_type: string
          external_event_key: string
          id: string
          payload: Json
          payment_id: string | null
          processed_at: string | null
          provider_account_id: string
          received_at: string
          status: Database["platform"]["Enums"]["webhook_event_status"]
          subscription_id: string | null
        }
        Insert: {
          error_code?: string | null
          error_message?: string | null
          event_type: string
          external_event_key: string
          id?: string
          payload?: Json
          payment_id?: string | null
          processed_at?: string | null
          provider_account_id: string
          received_at?: string
          status?: Database["platform"]["Enums"]["webhook_event_status"]
          subscription_id?: string | null
        }
        Update: {
          error_code?: string | null
          error_message?: string | null
          event_type?: string
          external_event_key?: string
          id?: string
          payload?: Json
          payment_id?: string | null
          processed_at?: string | null
          provider_account_id?: string
          received_at?: string
          status?: Database["platform"]["Enums"]["webhook_event_status"]
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_webhook_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_webhook_events_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_webhook_events_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "v_provider_account_routes"
            referencedColumns: ["provider_account_id"]
          },
          {
            foreignKeyName: "provider_webhook_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_webhook_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_renewal_dashboard"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_webhook_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_collection"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_webhook_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_documents"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_webhook_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_mrr"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_webhook_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["subscription_id"]
          },
        ]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_attributions_channel_organization_id_fkey"
            columns: ["channel_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_attributions_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
            referencedRelation: "v_renewal_dashboard"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "sales_attributions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_collection"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "sales_attributions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_documents"
            referencedColumns: ["subscription_id"]
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
      subscription_collection_profiles: {
        Row: {
          auto_charge: boolean
          auto_suspend: boolean
          collection_method: Database["platform"]["Enums"]["collection_method"]
          created_at: string
          currency: string
          document_lead_days: number
          effective_from: string
          effective_to: string | null
          grace_period_days: number
          id: string
          invoice_lead_days: number
          notes: string | null
          payment_due_days: number
          provider_account_id: string | null
          renewal_notice_days: number
          requires_purchase_order: boolean
          requires_service_order: boolean
          status: Database["platform"]["Enums"]["collection_profile_status"]
          subscription_id: string
          updated_at: string
        }
        Insert: {
          auto_charge?: boolean
          auto_suspend?: boolean
          collection_method: Database["platform"]["Enums"]["collection_method"]
          created_at?: string
          currency: string
          document_lead_days?: number
          effective_from?: string
          effective_to?: string | null
          grace_period_days?: number
          id?: string
          invoice_lead_days?: number
          notes?: string | null
          payment_due_days?: number
          provider_account_id?: string | null
          renewal_notice_days?: number
          requires_purchase_order?: boolean
          requires_service_order?: boolean
          status?: Database["platform"]["Enums"]["collection_profile_status"]
          subscription_id: string
          updated_at?: string
        }
        Update: {
          auto_charge?: boolean
          auto_suspend?: boolean
          collection_method?: Database["platform"]["Enums"]["collection_method"]
          created_at?: string
          currency?: string
          document_lead_days?: number
          effective_from?: string
          effective_to?: string | null
          grace_period_days?: number
          id?: string
          invoice_lead_days?: number
          notes?: string | null
          payment_due_days?: number
          provider_account_id?: string | null
          renewal_notice_days?: number
          requires_purchase_order?: boolean
          requires_service_order?: boolean
          status?: Database["platform"]["Enums"]["collection_profile_status"]
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_collection_profiles_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "subscription_collection_profiles_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_collection_profiles_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "v_provider_account_routes"
            referencedColumns: ["provider_account_id"]
          },
          {
            foreignKeyName: "subscription_collection_profiles_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_collection_profiles_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_renewal_dashboard"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_collection_profiles_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_collection"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_collection_profiles_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_documents"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_collection_profiles_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_mrr"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_collection_profiles_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["subscription_id"]
          },
        ]
      }
      subscription_commercial_documents: {
        Row: {
          amount: number | null
          approved_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          document_number: string | null
          document_type: Database["platform"]["Enums"]["commercial_document_type"]
          external_file_ref: string | null
          id: string
          notes: string | null
          received_at: string | null
          rejected_at: string | null
          requested_at: string
          status: Database["platform"]["Enums"]["commercial_document_status"]
          subscription_id: string
          updated_at: string
          updated_by: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          amount?: number | null
          approved_at?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          document_number?: string | null
          document_type: Database["platform"]["Enums"]["commercial_document_type"]
          external_file_ref?: string | null
          id?: string
          notes?: string | null
          received_at?: string | null
          rejected_at?: string | null
          requested_at?: string
          status?: Database["platform"]["Enums"]["commercial_document_status"]
          subscription_id: string
          updated_at?: string
          updated_by?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          amount?: number | null
          approved_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          document_number?: string | null
          document_type?: Database["platform"]["Enums"]["commercial_document_type"]
          external_file_ref?: string | null
          id?: string
          notes?: string | null
          received_at?: string | null
          rejected_at?: string | null
          requested_at?: string
          status?: Database["platform"]["Enums"]["commercial_document_status"]
          subscription_id?: string
          updated_at?: string
          updated_by?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_commercial_documents_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "subscription_commercial_documents_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_commercial_documents_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_renewal_dashboard"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_commercial_documents_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_collection"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_commercial_documents_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_documents"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_commercial_documents_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_mrr"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_commercial_documents_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["subscription_id"]
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
          currency: string
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
            foreignKeyName: "subscription_items_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
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
            referencedRelation: "v_renewal_dashboard"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_items_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_collection"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "subscription_items_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_documents"
            referencedColumns: ["subscription_id"]
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
          market_id: string | null
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
          currency: string
          ends_on?: string | null
          id?: string
          market_id?: string | null
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
          market_id?: string | null
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            foreignKeyName: "subscriptions_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "subscriptions_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
            foreignKeyName: "tenants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_company_markets"
            referencedColumns: ["company_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenants_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenants_managing_organization_id_fkey"
            columns: ["managing_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "workspace_apps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
      v_billing_contact_readiness: {
        Row: {
          billing_address: string | null
          billing_city: string | null
          billing_email: string | null
          billing_first_name: string | null
          billing_last_name: string | null
          billing_phone: string | null
          country_code: string | null
          missing_fields: string[] | null
          organization_id: string | null
          organization_name: string | null
          ready_for_card_payment: boolean | null
        }
        Insert: {
          billing_address?: string | null
          billing_city?: string | null
          billing_email?: string | null
          billing_first_name?: string | null
          billing_last_name?: string | null
          billing_phone?: string | null
          country_code?: string | null
          missing_fields?: never
          organization_id?: string | null
          organization_name?: string | null
          ready_for_card_payment?: never
        }
        Update: {
          billing_address?: string | null
          billing_city?: string | null
          billing_email?: string | null
          billing_first_name?: string | null
          billing_last_name?: string | null
          billing_phone?: string | null
          country_code?: string | null
          missing_fields?: never
          organization_id?: string | null
          organization_name?: string | null
          ready_for_card_payment?: never
        }
        Relationships: []
      }
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
            foreignKeyName: "invoices_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "invoices_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
      v_commission_detail: {
        Row: {
          agent_code: string | null
          agent_name: string | null
          amount: number | null
          applied_rate: number | null
          attribution_pct: number | null
          base_amount: number | null
          charge_kind: Database["platform"]["Enums"]["charge_kind"] | null
          commission_event_id: string | null
          currency: string | null
          earned_on: string | null
          has_reversal: boolean | null
          invoice_id: string | null
          invoice_number: string | null
          is_reversal: boolean | null
          paid_at: string | null
          payment_id: string | null
          payment_method: string | null
          payment_reference: string | null
          payment_status: Database["platform"]["Enums"]["payment_status"] | null
          product_short_name: string | null
          reversal_of_event_id: string | null
          reversal_reason: string | null
          rule_basis: Database["platform"]["Enums"]["commission_basis"] | null
          rule_name: string | null
          saas_product_id: string | null
          sales_agent_id: string | null
          settlement_code: string | null
          settlement_id: string | null
          settlement_status:
            | Database["platform"]["Enums"]["settlement_status"]
            | null
          source_label: string | null
          status: Database["platform"]["Enums"]["commission_status"] | null
          tenant_id: string | null
          tenant_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_events_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "commission_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_reversal_of_event_id_fkey"
            columns: ["reversal_of_event_id"]
            isOneToOne: false
            referencedRelation: "commission_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_reversal_of_event_id_fkey"
            columns: ["reversal_of_event_id"]
            isOneToOne: false
            referencedRelation: "v_commission_detail"
            referencedColumns: ["commission_event_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
      v_company_markets: {
        Row: {
          company_id: string | null
          country_code: string | null
          currency: string | null
          in_regional_model: boolean | null
          is_default: boolean | null
          market_code: string | null
          market_default_currency: string | null
          market_id: string | null
          market_name: string | null
          name: string | null
          organization_id: string | null
          organization_kind: Database["platform"]["Enums"]["org_kind"] | null
          organization_name: string | null
          status: Database["platform"]["Enums"]["entity_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "companies_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
          {
            foreignKeyName: "markets_default_currency_code_fkey"
            columns: ["market_default_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      v_currency_integrity_issues: {
        Row: {
          issue_kind: string | null
          parent_currency: string | null
          parent_id: string | null
          parent_kind: string | null
          record_currency: string | null
          record_id: string | null
        }
        Relationships: []
      }
      v_finance_reconciliation: {
        Row: {
          amount: number | null
          currency: string | null
          detail: string | null
          finding_type: string | null
          organization_name: string | null
          severity: string | null
          subject: string | null
          subscription_id: string | null
        }
        Relationships: []
      }
      v_partner_agreements: {
        Row: {
          agreement_id: string | null
          allowed_deployment_modes:
            | Database["platform"]["Enums"]["deployment_mode"][]
            | null
          allowed_tenant_types:
            | Database["platform"]["Enums"]["tenant_type"][]
            | null
          billing_responsibility:
            | Database["platform"]["Enums"]["billing_responsibility"]
            | null
          can_manage_tenants: boolean | null
          can_resell: boolean | null
          channel_mrr: number | null
          default_deployment_mode:
            | Database["platform"]["Enums"]["deployment_mode"]
            | null
          managed_tenants: number | null
          margin_rate: number | null
          max_tenants: number | null
          notes: string | null
          organization_id: string | null
          organization_name: string | null
          organization_slug: string | null
          product_code: string | null
          product_short_name: string | null
          saas_product_id: string | null
          shared_tenants: number | null
          status: Database["platform"]["Enums"]["entity_status"] | null
          valid_from: string | null
          valid_to: string | null
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_product_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
      v_partner_finance: {
        Row: {
          active_agreements: number | null
          agent_commissions: number | null
          collected_revenue: number | null
          currency: string | null
          direct_cost: number | null
          gross_margin: number | null
          managed_tenants: number | null
          mrr: number | null
          organization_id: string | null
          organization_name: string | null
          organization_slug: string | null
          weighted_channel_margin_rate: number | null
        }
        Relationships: []
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
      v_plan_price_catalog: {
        Row: {
          amount: number | null
          billing_interval:
            | Database["platform"]["Enums"]["billing_interval"]
            | null
          charge_kind: Database["platform"]["Enums"]["charge_kind"] | null
          currency: string | null
          deployment_mode:
            | Database["platform"]["Enums"]["deployment_mode"]
            | null
          is_current: boolean | null
          is_legacy: boolean | null
          is_scheduled: boolean | null
          market_code: string | null
          market_id: string | null
          market_name: string | null
          plan_code: string | null
          plan_id: string | null
          plan_name: string | null
          price_id: string | null
          saas_product_id: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_prices_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "plan_prices_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_prices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
      v_product_finance: {
        Row: {
          active_subscriptions: number | null
          active_tenants: number | null
          arr: number | null
          collected_implementation: number | null
          collected_infrastructure: number | null
          collected_license: number | null
          collected_one_time: number | null
          collected_recurring: number | null
          collected_revenue: number | null
          collected_support: number | null
          commission_paid: number | null
          commission_pending: number | null
          commission_total: number | null
          currency: string | null
          direct_cost: number | null
          gross_margin: number | null
          margin_rate: number | null
          mrr: number | null
          product_code: string | null
          saas_product_id: string | null
          short_name: string | null
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
      v_provider_account_routes: {
        Row: {
          code: string | null
          country_code: string | null
          currencies: string[] | null
          environment:
            | Database["platform"]["Enums"]["provider_environment"]
            | null
          is_live: boolean | null
          market_code: string | null
          market_id: string | null
          market_name: string | null
          name: string | null
          owner_organization_id: string | null
          primary_currency: string | null
          provider_account_id: string | null
          provider_kind: Database["platform"]["Enums"]["provider_kind"] | null
          routing_priority: number | null
          status: Database["platform"]["Enums"]["entity_status"] | null
          supported_methods: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_provider_accounts_currency_fk"
            columns: ["primary_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payment_provider_accounts_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_margin"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["customer_organization_id"]
          },
          {
            foreignKeyName: "payment_provider_accounts_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["managing_organization_id"]
          },
        ]
      }
      v_provider_reconciliation: {
        Row: {
          billed_organization_id: string | null
          billed_organization_name: string | null
          confirmed_payments: number | null
          external_subscription_id: string | null
          last_error_code: string | null
          last_error_message: string | null
          local_status:
            | Database["platform"]["Enums"]["subscription_status"]
            | null
          next_billing_at: string | null
          provider_account_code: string | null
          provider_account_id: string | null
          provider_environment:
            | Database["platform"]["Enums"]["provider_environment"]
            | null
          provider_status: string | null
          provider_subscription_id: string | null
          reconciliation_status: string | null
          rejected_events: number | null
          subscription_code: string | null
          subscription_id: string | null
          synced_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_subscriptions_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_subscriptions_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "v_provider_account_routes"
            referencedColumns: ["provider_account_id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_renewal_dashboard"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_collection"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_documents"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_mrr"
            referencedColumns: ["subscription_id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_tenant_overview"
            referencedColumns: ["subscription_id"]
          },
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
        ]
      }
      v_renewal_dashboard: {
        Row: {
          auto_suspend: boolean | null
          billed_organization_id: string | null
          billed_organization_name: string | null
          billing_interval:
            | Database["platform"]["Enums"]["billing_interval"]
            | null
          collection_method:
            | Database["platform"]["Enums"]["collection_method"]
            | null
          critical_alerts: number | null
          currency: string | null
          days_to_renewal: number | null
          grace_period_days: number | null
          in_grace: boolean | null
          is_past_due: boolean | null
          open_alerts: number | null
          product_code: string | null
          product_short_name: string | null
          provider_account_code: string | null
          renewal_on: string | null
          renewal_window: string | null
          subscription_code: string | null
          subscription_id: string | null
          subscription_status:
            | Database["platform"]["Enums"]["subscription_status"]
            | null
          suspension_pending: boolean | null
          tenant_id: string | null
          tenant_name: string | null
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
      v_subscription_collection: {
        Row: {
          auto_charge: boolean | null
          auto_suspend: boolean | null
          billed_organization_id: string | null
          billed_organization_name: string | null
          billing_interval:
            | Database["platform"]["Enums"]["billing_interval"]
            | null
          collection_method:
            | Database["platform"]["Enums"]["collection_method"]
            | null
          currency: string | null
          document_lead_days: number | null
          effective_from: string | null
          ends_on: string | null
          grace_period_days: number | null
          invoice_lead_days: number | null
          payment_due_days: number | null
          product_code: string | null
          product_short_name: string | null
          profile_id: string | null
          profile_missing: boolean | null
          profile_status:
            | Database["platform"]["Enums"]["collection_profile_status"]
            | null
          provider_account_code: string | null
          provider_account_id: string | null
          provider_environment:
            | Database["platform"]["Enums"]["provider_environment"]
            | null
          provider_kind: Database["platform"]["Enums"]["provider_kind"] | null
          renewal_notice_days: number | null
          requires_purchase_order: boolean | null
          requires_service_order: boolean | null
          saas_product_id: string | null
          started_on: string | null
          subscription_code: string | null
          subscription_id: string | null
          subscription_status:
            | Database["platform"]["Enums"]["subscription_status"]
            | null
          tenant_id: string | null
          tenant_name: string | null
          tenant_slug: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_collection_profiles_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_collection_profiles_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "v_provider_account_routes"
            referencedColumns: ["provider_account_id"]
          },
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
      v_subscription_documents: {
        Row: {
          approved_at: string | null
          billed_organization_id: string | null
          billed_organization_name: string | null
          collection_method:
            | Database["platform"]["Enums"]["collection_method"]
            | null
          document_amount: number | null
          document_currency: string | null
          document_id: string | null
          document_lead_days: number | null
          document_number: string | null
          document_ok: boolean | null
          document_required: boolean | null
          document_status:
            | Database["platform"]["Enums"]["commercial_document_status"]
            | null
          document_type:
            | Database["platform"]["Enums"]["commercial_document_type"]
            | null
          external_file_ref: string | null
          product_code: string | null
          received_at: string | null
          requested_at: string | null
          requires_purchase_order: boolean | null
          requires_service_order: boolean | null
          subscription_code: string | null
          subscription_id: string | null
          tenant_name: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_commercial_documents_currency_fk"
            columns: ["document_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
        ]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "subscriptions_billed_organization_id_fkey"
            columns: ["billed_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
            foreignKeyName: "subscriptions_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
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
            referencedRelation: "v_product_finance"
            referencedColumns: ["saas_product_id"]
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
            referencedRelation: "v_billing_contact_readiness"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenants_managing_organization_id_fkey"
            columns: ["managing_organization_id"]
            isOneToOne: false
            referencedRelation: "v_partner_finance"
            referencedColumns: ["organization_id"]
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
      apply_due_suspensions: {
        Args: { p_as_of?: string; p_mode?: string }
        Returns: Json
      }
      approve_commercial_document: {
        Args: { p_document_id: string; p_notes?: string; p_valid_to?: string }
        Returns: undefined
      }
      archive_saas_product: {
        Args: { p_product_id: string; p_reason?: string }
        Returns: undefined
      }
      attach_tenant_to_target: {
        Args: {
          p_deployment_target_id: string
          p_is_primary?: boolean
          p_notes?: string
          p_tenant_id: string
        }
        Returns: string
      }
      can_manage_commercial: { Args: never; Returns: boolean }
      can_manage_platform_entities: { Args: never; Returns: boolean }
      can_manage_regional_catalog: { Args: never; Returns: boolean }
      can_manage_subscription_documents: {
        Args: { p_subscription_id: string }
        Returns: boolean
      }
      can_manage_tenant: { Args: { p_tenant: string }; Returns: boolean }
      can_read_finance: { Args: never; Returns: boolean }
      can_read_tenant: { Args: { p_tenant: string }; Returns: boolean }
      can_run_provisioning: { Args: never; Returns: boolean }
      cancel_commercial_document: {
        Args: { p_document_id: string; p_reason?: string }
        Returns: undefined
      }
      confirm_manual_payment: {
        Args: {
          p_amount: number
          p_invoice_id: string
          p_method?: string
          p_notes?: string
          p_paid_at?: string
          p_reference: string
        }
        Returns: Json
      }
      create_sales_attribution: {
        Args: {
          p_attribution_pct: number
          p_channel_organization_id?: string
          p_commission_plan_id?: string
          p_customer_organization_id: string
          p_notes?: string
          p_saas_product_id: string
          p_sales_agent_id: string
          p_source?: Database["platform"]["Enums"]["attribution_source"]
          p_subscription_id?: string
          p_tenant_id?: string
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: string
      }
      create_subscription: {
        Args: {
          p_billed_organization_id: string
          p_billing_interval: Database["platform"]["Enums"]["billing_interval"]
          p_channel_margin_rate?: number
          p_code?: string
          p_currency?: string
          p_ends_on?: string
          p_market_code: string
          p_metadata?: Json
          p_notes?: string
          p_plan_id: string
          p_quantity?: number
          p_saas_product_id: string
          p_started_on?: string
          p_status?: Database["platform"]["Enums"]["subscription_status"]
          p_tenant_id?: string
        }
        Returns: string
      }
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
      current_plan_price: {
        Args: {
          p_as_of?: string
          p_billing_interval: Database["platform"]["Enums"]["billing_interval"]
          p_charge_kind: Database["platform"]["Enums"]["charge_kind"]
          p_currency: string
          p_market_id: string
          p_plan_id: string
        }
        Returns: number
      }
      dashboard_summary: { Args: never; Returns: Json }
      deactivate_commission_rule: {
        Args: { p_reason?: string; p_rule_id: string; p_valid_to?: string }
        Returns: undefined
      }
      effective_config: { Args: { p_company: string }; Returns: Json }
      effective_tenant_config: { Args: { p_tenant: string }; Returns: Json }
      end_product_agreement: {
        Args: { p_agreement_id: string; p_reason?: string; p_valid_to?: string }
        Returns: undefined
      }
      end_sales_attribution: {
        Args: {
          p_attribution_id: string
          p_reason?: string
          p_valid_to?: string
        }
        Returns: undefined
      }
      end_subscription_item: {
        Args: { p_item_id: string; p_valid_to?: string }
        Returns: undefined
      }
      enqueue_provisioning_request: {
        Args: {
          p_action: Database["platform"]["Enums"]["provisioning_action"]
          p_deployment_target_id?: string
          p_idempotency_key?: string
          p_mode?: string
          p_payload?: Json
          p_saas_product_id?: string
          p_tenant_id?: string
        }
        Returns: string
      }
      expire_commercial_documents: {
        Args: { p_as_of?: string }
        Returns: number
      }
      fx_convert: {
        Args: {
          p_amount: number
          p_as_of: string
          p_from: string
          p_max_age_days?: number
          p_to: string
        }
        Returns: {
          amount: number
          is_demo: boolean
          rate: number
          rate_date: string
          rate_id: string
          status: string
        }[]
      }
      fx_rate_lookup: {
        Args: {
          p_as_of: string
          p_base: string
          p_max_age_days?: number
          p_quote: string
        }
        Returns: {
          is_demo: boolean
          rate: number
          rate_date: string
          rate_id: string
          source: Database["platform"]["Enums"]["fx_rate_source"]
          status: string
        }[]
      }
      generate_commission_events: {
        Args: { p_payment_id: string }
        Returns: number
      }
      has_org_commercial_access: { Args: { p_org: string }; Returns: boolean }
      has_platform_role: {
        Args: { p_role: Database["platform"]["Enums"]["platform_role"] }
        Returns: boolean
      }
      is_currency_active: { Args: { p_currency: string }; Returns: boolean }
      is_currency_allowed_in_market: {
        Args: { p_currency: string; p_market_id: string }
        Returns: boolean
      }
      is_org_admin: { Args: { p_org: string }; Returns: boolean }
      is_org_member: { Args: { p_org: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_sales_agent: { Args: never; Returns: boolean }
      is_service_context: { Args: never; Returns: boolean }
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
      market_id_by_code: { Args: { p_code: string }; Returns: string }
      my_attributed_org_ids: { Args: never; Returns: string[] }
      my_attributed_tenant_ids: { Args: never; Returns: string[] }
      my_direct_tenant_ids: { Args: never; Returns: string[] }
      my_org_ids: { Args: never; Returns: string[] }
      my_sales_agent_ids: { Args: never; Returns: string[] }
      my_tenant_ids: { Args: never; Returns: string[] }
      next_renewal_date: {
        Args: {
          p_as_of?: string
          p_billing_interval: Database["platform"]["Enums"]["billing_interval"]
          p_ends_on: string
          p_started_on: string
        }
        Returns: string
      }
      onboard_customer_subscription: {
        Args: {
          p_activate?: boolean
          p_admin_email: string
          p_attribution_pct?: number
          p_attribution_source?: Database["platform"]["Enums"]["attribution_source"]
          p_billing_interval?: Database["platform"]["Enums"]["billing_interval"]
          p_channel_margin_rate?: number
          p_commission_plan_id?: string
          p_company_id?: string
          p_currency?: string
          p_customer_organization_id: string
          p_deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          p_deployment_target_id?: string
          p_implementation_fee?: number
          p_infrastructure_fee?: number
          p_license_amount?: number
          p_managing_organization_id?: string
          p_market_code: string
          p_notes?: string
          p_plan_id: string
          p_provisioning_mode?: string
          p_quantity?: number
          p_saas_product_code: string
          p_sales_agent_id?: string
          p_started_on?: string
          p_support_fee?: number
          p_tenant_name: string
          p_tenant_slug: string
          p_tenant_type?: Database["platform"]["Enums"]["tenant_type"]
        }
        Returns: Json
      }
      plan_has_regional_price: {
        Args: {
          p_as_of?: string
          p_currency: string
          p_market_id: string
          p_plan_id: string
        }
        Returns: boolean
      }
      provider_account_candidates: {
        Args: {
          p_collection_method: Database["platform"]["Enums"]["collection_method"]
          p_subscription_id: string
        }
        Returns: {
          account_code: string
          account_name: string
          currencies: string[]
          eligible: boolean
          environment: Database["platform"]["Enums"]["provider_environment"]
          market_code: string
          owner_organization_id: string
          provider_account_id: string
          provider_kind: Database["platform"]["Enums"]["provider_kind"]
          reason: string
          route_rank: number
        }[]
      }
      provider_kind_supports_method: {
        Args: {
          p_kind: Database["platform"]["Enums"]["provider_kind"]
          p_method: Database["platform"]["Enums"]["collection_method"]
        }
        Returns: boolean
      }
      receive_commercial_document: {
        Args: {
          p_amount?: number
          p_document_id: string
          p_document_number: string
          p_external_file_ref?: string
          p_notes?: string
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: undefined
      }
      refresh_billing_alerts: { Args: { p_as_of?: string }; Returns: number }
      register_provider_payment: {
        Args: {
          p_amount: number
          p_currency: string
          p_event_type: string
          p_external_charge_id: string
          p_external_event_key: string
          p_external_subscription_id: string
          p_paid_at?: string
          p_payload?: Json
          p_provider_account_id: string
        }
        Returns: Json
      }
      register_provider_payment_failure: {
        Args: {
          p_error_code?: string
          p_error_message?: string
          p_event_type: string
          p_external_event_key: string
          p_external_subscription_id: string
          p_payload?: Json
          p_provider_account_id: string
        }
        Returns: Json
      }
      reject_commercial_document: {
        Args: { p_document_id: string; p_reason: string }
        Returns: undefined
      }
      reporting_settings: {
        Args: never
        Returns: {
          fx_max_rate_age_days: number
          reporting_currency: string
        }[]
      }
      request_commercial_document: {
        Args: {
          p_amount?: number
          p_currency?: string
          p_document_type: Database["platform"]["Enums"]["commercial_document_type"]
          p_notes?: string
          p_subscription_id: string
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: string
      }
      request_tenant_resume: {
        Args: { p_mode?: string; p_reason?: string; p_tenant_id: string }
        Returns: Json
      }
      request_tenant_suspension: {
        Args: { p_mode?: string; p_reason: string; p_tenant_id: string }
        Returns: Json
      }
      require_active_market: {
        Args: { p_market_code: string }
        Returns: {
          code: string
          country_code: string
          created_at: string
          default_currency_code: string
          id: string
          name: string
          sort_order: number
          status: Database["platform"]["Enums"]["entity_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "markets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_market_currency: {
        Args: { p_currency: string; p_market_id: string }
        Returns: string
      }
      retry_provisioning_request: {
        Args: { p_request_id: string }
        Returns: string
      }
      reverse_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: Json
      }
      set_billing_alert_status: {
        Args: {
          p_alert_id: string
          p_note?: string
          p_status: Database["platform"]["Enums"]["billing_alert_status"]
        }
        Returns: undefined
      }
      set_billing_contact: {
        Args: {
          p_address: string
          p_city: string
          p_email: string
          p_first_name: string
          p_last_name: string
          p_organization_id: string
          p_phone: string
        }
        Returns: string
      }
      set_exchange_rate: {
        Args: {
          p_base: string
          p_is_demo?: boolean
          p_notes?: string
          p_quote: string
          p_rate: number
          p_rate_date: string
          p_source?: Database["platform"]["Enums"]["fx_rate_source"]
        }
        Returns: string
      }
      set_plan_price: {
        Args: {
          p_amount: number
          p_billing_interval: Database["platform"]["Enums"]["billing_interval"]
          p_charge_kind: Database["platform"]["Enums"]["charge_kind"]
          p_currency: string
          p_market_code: string
          p_plan_id: string
          p_valid_from?: string
        }
        Returns: string
      }
      set_reporting_settings: {
        Args: { p_fx_max_rate_age_days?: number; p_reporting_currency: string }
        Returns: undefined
      }
      set_subscription_collection_profile: {
        Args: {
          p_auto_charge?: boolean
          p_auto_suspend?: boolean
          p_collection_method: Database["platform"]["Enums"]["collection_method"]
          p_currency?: string
          p_document_lead_days?: number
          p_effective_from?: string
          p_grace_period_days?: number
          p_invoice_lead_days?: number
          p_notes?: string
          p_payment_due_days?: number
          p_provider_account_id?: string
          p_renewal_notice_days?: number
          p_requires_purchase_order?: boolean
          p_requires_service_order?: boolean
          p_route_provider?: boolean
          p_status?: Database["platform"]["Enums"]["collection_profile_status"]
          p_subscription_id: string
        }
        Returns: string
      }
      set_subscription_status: {
        Args: {
          p_reason?: string
          p_status: Database["platform"]["Enums"]["subscription_status"]
          p_subscription_id: string
        }
        Returns: undefined
      }
      set_tenant_feature: {
        Args: {
          p_enabled: boolean
          p_feature_key: string
          p_tenant_id: string
          p_value?: Json
        }
        Returns: undefined
      }
      set_tenant_status: {
        Args: {
          p_reason?: string
          p_status: Database["platform"]["Enums"]["tenant_status"]
          p_tenant_id: string
        }
        Returns: undefined
      }
      settle_commissions: {
        Args: {
          p_currency?: string
          p_period_end: string
          p_period_start: string
          p_sales_agent_id: string
        }
        Returns: string
      }
      to_reporting_amount: {
        Args: {
          p_amount: number
          p_as_of: string
          p_currency: string
          p_max_age_days?: number
          p_reporting_currency?: string
        }
        Returns: {
          conversion_status: string
          fx_is_demo: boolean
          fx_method: string
          fx_rate: number
          fx_rate_date: string
          fx_rate_id: string
          native_amount: number
          native_currency: string
          reporting_amount: number
          reporting_currency: string
        }[]
      }
      update_tenant: {
        Args: {
          p_accent_color?: string
          p_admin_email?: string
          p_logo_url?: string
          p_metadata?: Json
          p_name: string
          p_tenant_id: string
          p_white_label?: boolean
        }
        Returns: undefined
      }
      upsert_catalog_item: {
        Args: {
          p_available?: boolean
          p_code: string
          p_currency?: string
          p_description?: string
          p_id?: string
          p_item_type?: string
          p_name: string
          p_price_month?: number
          p_saas_product_id?: string
          p_scope?: string
        }
        Returns: string
      }
      upsert_commission_plan: {
        Args: {
          p_code: string
          p_description?: string
          p_id?: string
          p_name: string
          p_saas_product_id?: string
          p_status?: Database["platform"]["Enums"]["entity_status"]
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: string
      }
      upsert_commission_rule: {
        Args: {
          p_basis: Database["platform"]["Enums"]["commission_basis"]
          p_charge_kind?: Database["platform"]["Enums"]["charge_kind"]
          p_commission_plan_id: string
          p_currency?: string
          p_fixed_amount?: number
          p_id?: string
          p_is_recurring?: boolean
          p_max_months?: number
          p_max_total_amount?: number
          p_name: string
          p_priority?: number
          p_rate?: number
          p_status?: Database["platform"]["Enums"]["entity_status"]
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: string
      }
      upsert_company: {
        Args: {
          p_country_code?: string
          p_currency?: string
          p_erp_code?: string
          p_id?: string
          p_is_default?: boolean
          p_market_code?: string
          p_name: string
          p_organization_id: string
          p_status?: Database["platform"]["Enums"]["entity_status"]
          p_tax_id?: string
        }
        Returns: string
      }
      upsert_currency: {
        Args: {
          p_code: string
          p_decimals: number
          p_name: string
          p_status?: Database["platform"]["Enums"]["entity_status"]
          p_symbol?: string
        }
        Returns: string
      }
      upsert_deployment_target: {
        Args: {
          p_code: string
          p_cost_center?: string
          p_deployment_mode: Database["platform"]["Enums"]["deployment_mode"]
          p_environment?: Database["platform"]["Enums"]["environment_kind"]
          p_id?: string
          p_metadata?: Json
          p_name: string
          p_owner_organization_id?: string
          p_provider: Database["platform"]["Enums"]["infra_provider"]
          p_provider_project_ref?: string
          p_region?: string
          p_saas_product_id?: string
          p_status?: Database["platform"]["Enums"]["entity_status"]
        }
        Returns: string
      }
      upsert_market: {
        Args: {
          p_allowed_currency_codes: string[]
          p_code: string
          p_country_code: string
          p_default_currency_code: string
          p_name: string
          p_sort_order?: number
          p_status?: Database["platform"]["Enums"]["entity_status"]
        }
        Returns: string
      }
      upsert_organization: {
        Args: {
          p_accent_color?: string
          p_billing_email?: string
          p_brand_slug?: string
          p_capabilities?: Database["platform"]["Enums"]["org_capability"][]
          p_country_code?: string
          p_display_name: string
          p_id?: string
          p_legal_name: string
          p_logo_url?: string
          p_metadata?: Json
          p_slug: string
          p_status?: Database["platform"]["Enums"]["entity_status"]
          p_tax_id?: string
          p_white_label?: boolean
        }
        Returns: string
      }
      upsert_payment_provider_account: {
        Args: {
          p_code: string
          p_currencies?: string[]
          p_environment?: Database["platform"]["Enums"]["provider_environment"]
          p_id?: string
          p_market_code?: string
          p_metadata?: Json
          p_name: string
          p_owner_organization_id?: string
          p_provider_kind: Database["platform"]["Enums"]["provider_kind"]
          p_public_key?: string
          p_routing_priority?: number
          p_rsa_id_ref?: string
          p_rsa_public_key_ref?: string
          p_secret_key_ref?: string
          p_status?: Database["platform"]["Enums"]["entity_status"]
          p_webhook_endpoint?: string
        }
        Returns: string
      }
      upsert_plan: {
        Args: {
          p_code: string
          p_deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          p_description?: string
          p_id?: string
          p_included_companies?: number
          p_is_partner_base?: boolean
          p_metadata?: Json
          p_multi_country?: boolean
          p_name: string
          p_saas_product_id: string
          p_sort_order?: number
          p_status?: Database["platform"]["Enums"]["entity_status"]
        }
        Returns: string
      }
      upsert_product_agreement: {
        Args: {
          p_allowed_deployment_modes?: Database["platform"]["Enums"]["deployment_mode"][]
          p_allowed_tenant_types?: Database["platform"]["Enums"]["tenant_type"][]
          p_billing_responsibility?: Database["platform"]["Enums"]["billing_responsibility"]
          p_can_manage_tenants?: boolean
          p_can_resell?: boolean
          p_default_deployment_mode?: Database["platform"]["Enums"]["deployment_mode"]
          p_id?: string
          p_margin_rate?: number
          p_max_tenants?: number
          p_notes?: string
          p_organization_id: string
          p_saas_product_id: string
          p_status?: Database["platform"]["Enums"]["entity_status"]
          p_terms?: Json
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: string
      }
      upsert_provider_subscription: {
        Args: {
          p_external_customer_id?: string
          p_external_payment_method_id?: string
          p_external_plan_id?: string
          p_external_subscription_id: string
          p_metadata?: Json
          p_next_billing_at?: string
          p_provider_account_id: string
          p_provider_status?: string
          p_subscription_id: string
        }
        Returns: string
      }
      upsert_saas_product: {
        Args: {
          p_accent_color?: string
          p_billing_unit?: string
          p_code: string
          p_description?: string
          p_id?: string
          p_is_billable?: boolean
          p_metadata?: Json
          p_name: string
          p_short_name: string
          p_sort_order?: number
          p_status?: Database["platform"]["Enums"]["entity_status"]
        }
        Returns: string
      }
      upsert_sales_agent: {
        Args: {
          p_agent_type?: Database["platform"]["Enums"]["sales_agent_type"]
          p_code: string
          p_contact_email?: string
          p_full_name: string
          p_id?: string
          p_metadata?: Json
          p_organization_id?: string
          p_status?: Database["platform"]["Enums"]["entity_status"]
          p_user_id?: string
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: string
      }
      upsert_subscription_item: {
        Args: {
          p_billing_interval: Database["platform"]["Enums"]["billing_interval"]
          p_catalog_item_code?: string
          p_charge_kind: Database["platform"]["Enums"]["charge_kind"]
          p_currency?: string
          p_description: string
          p_id?: string
          p_quantity: number
          p_subscription_id: string
          p_tenant_id?: string
          p_unit_amount: number
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: string
      }
      void_exchange_rate: {
        Args: { p_rate_id: string; p_reason: string }
        Returns: undefined
      }
    }
    Enums: {
      attribution_source:
        | "DIRECT"
        | "PARTNER"
        | "REFERRAL"
        | "INBOUND"
        | "CAMPAIGN"
      billing_alert_status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED"
      billing_alert_type:
        | "REQUEST_DOCUMENT"
        | "RENEWAL_NOTICE"
        | "PAYMENT_DUE"
        | "PAST_DUE"
        | "GRACE_ENDING"
        | "SUSPENSION_DUE"
        | "PAYMENT_FAILURE"
        | "DOCUMENT_EXPIRING"
      billing_interval: "MONTHLY" | "QUARTERLY" | "YEARLY" | "ONE_TIME"
      billing_responsibility: "EBIM" | "PARTNER" | "MIXED"
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
      collection_method:
        | "CULQI_CARD"
        | "SERVICE_ORDER"
        | "PURCHASE_ORDER"
        | "BANK_TRANSFER"
        | "MANUAL"
      collection_profile_status: "ACTIVE" | "INACTIVE" | "PENDING_SETUP"
      commercial_document_status:
        | "REQUESTED"
        | "RECEIVED"
        | "APPROVED"
        | "REJECTED"
        | "EXPIRED"
        | "CANCELLED"
      commercial_document_type: "SERVICE_ORDER" | "PURCHASE_ORDER"
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
      fx_rate_source: "MANUAL"
      fx_rate_status: "ACTIVE" | "SUPERSEDED" | "VOIDED"
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
      provider_environment: "TEST" | "LIVE"
      provider_kind: "CULQI" | "MANUAL" | "BANK" | "OTHER"
      provider_mapping_status: "ACTIVE" | "INACTIVE" | "FAILED" | "PENDING"
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
      webhook_event_status: "RECEIVED" | "PROCESSED" | "IGNORED" | "REJECTED"
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
      billing_alert_status: ["OPEN", "ACKNOWLEDGED", "RESOLVED", "CANCELLED"],
      billing_alert_type: [
        "REQUEST_DOCUMENT",
        "RENEWAL_NOTICE",
        "PAYMENT_DUE",
        "PAST_DUE",
        "GRACE_ENDING",
        "SUSPENSION_DUE",
        "PAYMENT_FAILURE",
        "DOCUMENT_EXPIRING",
      ],
      billing_interval: ["MONTHLY", "QUARTERLY", "YEARLY", "ONE_TIME"],
      billing_responsibility: ["EBIM", "PARTNER", "MIXED"],
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
      collection_method: [
        "CULQI_CARD",
        "SERVICE_ORDER",
        "PURCHASE_ORDER",
        "BANK_TRANSFER",
        "MANUAL",
      ],
      collection_profile_status: ["ACTIVE", "INACTIVE", "PENDING_SETUP"],
      commercial_document_status: [
        "REQUESTED",
        "RECEIVED",
        "APPROVED",
        "REJECTED",
        "EXPIRED",
        "CANCELLED",
      ],
      commercial_document_type: ["SERVICE_ORDER", "PURCHASE_ORDER"],
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
      fx_rate_source: ["MANUAL"],
      fx_rate_status: ["ACTIVE", "SUPERSEDED", "VOIDED"],
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
      provider_environment: ["TEST", "LIVE"],
      provider_kind: ["CULQI", "MANUAL", "BANK", "OTHER"],
      provider_mapping_status: ["ACTIVE", "INACTIVE", "FAILED", "PENDING"],
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
      webhook_event_status: ["RECEIVED", "PROCESSED", "IGNORED", "REJECTED"],
    },
  },
} as const

