export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  platform: {
    Tables: {
      ai_credit_ledger: {
        Row: {
          capability_id: string | null;
          created_at: string;
          created_by: string | null;
          credits: number;
          entry_idempotency_key: string;
          entry_type: string;
          id: string;
          period_start: string;
          policy_id: string | null;
          pool_key: string;
          quantity: number | null;
          reason: string | null;
          reverses_entry_id: string | null;
          saas_product_id: string;
          tenant_id: string;
          usage_aggregate_id: string | null;
          weight_applied: number | null;
          weight_id: string | null;
        };
        Insert: {
          capability_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          credits: number;
          entry_idempotency_key: string;
          entry_type: string;
          id?: string;
          period_start: string;
          policy_id?: string | null;
          pool_key: string;
          quantity?: number | null;
          reason?: string | null;
          reverses_entry_id?: string | null;
          saas_product_id: string;
          tenant_id: string;
          usage_aggregate_id?: string | null;
          weight_applied?: number | null;
          weight_id?: string | null;
        };
        Update: {
          capability_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          credits?: number;
          entry_idempotency_key?: string;
          entry_type?: string;
          id?: string;
          period_start?: string;
          policy_id?: string | null;
          pool_key?: string;
          quantity?: number | null;
          reason?: string | null;
          reverses_entry_id?: string | null;
          saas_product_id?: string;
          tenant_id?: string;
          usage_aggregate_id?: string | null;
          weight_applied?: number | null;
          weight_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_credit_ledger_capability_id_fkey';
            columns: ['capability_id'];
            isOneToOne: false;
            referencedRelation: 'product_capabilities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_policy_id_fkey';
            columns: ['policy_id'];
            isOneToOne: false;
            referencedRelation: 'ai_credit_policies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_reverses_entry_id_fkey';
            columns: ['reverses_entry_id'];
            isOneToOne: false;
            referencedRelation: 'ai_credit_ledger';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_usage_aggregate_id_fkey';
            columns: ['usage_aggregate_id'];
            isOneToOne: false;
            referencedRelation: 'usage_period_aggregates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_usage_aggregate_id_fkey';
            columns: ['usage_aggregate_id'];
            isOneToOne: false;
            referencedRelation: 'v_usage_period_aggregates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_weight_id_fkey';
            columns: ['weight_id'];
            isOneToOne: false;
            referencedRelation: 'ai_credit_weights';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_credit_policies: {
        Row: {
          catalog_item_id: string | null;
          created_at: string;
          created_by: string | null;
          expiry_policy: string | null;
          id: string;
          included_credits: number | null;
          overage_mode: string | null;
          plan_id: string | null;
          pool_scope: string | null;
          reason: string;
          rollover_policy: string | null;
          saas_product_id: string;
          source_type: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          catalog_item_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          expiry_policy?: string | null;
          id?: string;
          included_credits?: number | null;
          overage_mode?: string | null;
          plan_id?: string | null;
          pool_scope?: string | null;
          reason: string;
          rollover_policy?: string | null;
          saas_product_id: string;
          source_type: string;
          valid_from: string;
          valid_to?: string | null;
        };
        Update: {
          catalog_item_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          expiry_policy?: string | null;
          id?: string;
          included_credits?: number | null;
          overage_mode?: string | null;
          plan_id?: string | null;
          pool_scope?: string | null;
          reason?: string;
          rollover_policy?: string | null;
          saas_product_id?: string;
          source_type?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_credit_policies_catalog_item_id_fkey';
            columns: ['catalog_item_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_policies_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_policies_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_policies_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_policies_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'ai_credit_policies_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'ai_credit_policies_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      ai_credit_weights: {
        Row: {
          capability_id: string;
          created_at: string;
          created_by: string | null;
          credits_per_unit: number;
          id: string;
          reason: string;
          unit: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          capability_id: string;
          created_at?: string;
          created_by?: string | null;
          credits_per_unit: number;
          id?: string;
          reason: string;
          unit: string;
          valid_from: string;
          valid_to?: string | null;
        };
        Update: {
          capability_id?: string;
          created_at?: string;
          created_by?: string | null;
          credits_per_unit?: number;
          id?: string;
          reason?: string;
          unit?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_credit_weights_capability_id_fkey';
            columns: ['capability_id'];
            isOneToOne: false;
            referencedRelation: 'product_capabilities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_weights_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_user_id: string | null;
          entity_id: string | null;
          entity_type: string;
          id: number;
          metadata: NonNullable<Json>;
          occurred_at: string;
          organization_id: string | null;
          tenant_id: string | null;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_user_id?: string | null;
          entity_id?: string | null;
          entity_type: string;
          id?: never;
          metadata?: NonNullable<Json>;
          occurred_at?: string;
          organization_id?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_user_id?: string | null;
          entity_id?: string | null;
          entity_type?: string;
          id?: never;
          metadata?: NonNullable<Json>;
          occurred_at?: string;
          organization_id?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_actor_user_id_fkey';
            columns: ['actor_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'audit_logs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_logs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'audit_logs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'audit_logs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      billing_alerts: {
        Row: {
          acknowledged_at: string | null;
          alert_type: Database['platform']['Enums']['billing_alert_type'];
          created_at: string;
          dedupe_key: string;
          document_id: string | null;
          due_at: string;
          id: string;
          invoice_id: string | null;
          message: string | null;
          metadata: NonNullable<Json>;
          reference_date: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          severity: string;
          status: Database['platform']['Enums']['billing_alert_status'];
          subscription_id: string;
          title: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          alert_type: Database['platform']['Enums']['billing_alert_type'];
          created_at?: string;
          dedupe_key: string;
          document_id?: string | null;
          due_at: string;
          id?: string;
          invoice_id?: string | null;
          message?: string | null;
          metadata?: NonNullable<Json>;
          reference_date?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: string;
          status?: Database['platform']['Enums']['billing_alert_status'];
          subscription_id: string;
          title: string;
        };
        Update: {
          acknowledged_at?: string | null;
          alert_type?: Database['platform']['Enums']['billing_alert_type'];
          created_at?: string;
          dedupe_key?: string;
          document_id?: string | null;
          due_at?: string;
          id?: string;
          invoice_id?: string | null;
          message?: string | null;
          metadata?: NonNullable<Json>;
          reference_date?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: string;
          status?: Database['platform']['Enums']['billing_alert_status'];
          subscription_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'billing_alerts_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'subscription_commercial_documents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'billing_alerts_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['document_id'];
          },
          {
            foreignKeyName: 'billing_alerts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'billing_alerts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'billing_alerts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_revenue';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'billing_alerts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'billing_alerts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_discount_sign_legacy_invoices';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'billing_alerts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_invoice_balances';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'billing_alerts_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'billing_alerts_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_alerts_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_alerts_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_alerts_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_alerts_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_alerts_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
        ];
      };
      billing_shadow_comparisons: {
        Row: {
          actor: string;
          actor_user_id: string | null;
          created_at: string;
          diffs: NonNullable<Json>;
          expected: NonNullable<Json>;
          id: string;
          local: NonNullable<Json>;
          mismatches: number;
          period_start: string;
          report_checksum: string;
          saas_product_id: string;
          source: string;
          subscription_id: string;
          tenant_id: string;
        };
        Insert: {
          actor: string;
          actor_user_id?: string | null;
          created_at?: string;
          diffs: NonNullable<Json>;
          expected: NonNullable<Json>;
          id?: string;
          local: NonNullable<Json>;
          mismatches: number;
          period_start: string;
          report_checksum: string;
          saas_product_id: string;
          source: string;
          subscription_id: string;
          tenant_id: string;
        };
        Update: {
          actor?: string;
          actor_user_id?: string | null;
          created_at?: string;
          diffs?: NonNullable<Json>;
          expected?: NonNullable<Json>;
          id?: string;
          local?: NonNullable<Json>;
          mismatches?: number;
          period_start?: string;
          report_checksum?: string;
          saas_product_id?: string;
          source?: string;
          subscription_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'billing_shadow_comparisons_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'billing_shadow_comparisons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      capability_aliases: {
        Row: {
          alias_code: string;
          alias_source: string;
          capability_id: string;
          created_at: string;
          id: string;
          saas_product_id: string;
        };
        Insert: {
          alias_code: string;
          alias_source: string;
          capability_id: string;
          created_at?: string;
          id?: string;
          saas_product_id: string;
        };
        Update: {
          alias_code?: string;
          alias_source?: string;
          capability_id?: string;
          created_at?: string;
          id?: string;
          saas_product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'capability_aliases_capability_id_fkey';
            columns: ['capability_id'];
            isOneToOne: false;
            referencedRelation: 'product_capabilities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'capability_aliases_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'capability_aliases_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'capability_aliases_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'capability_aliases_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      card_on_file_authorizations: {
        Row: {
          accepted_at: string;
          client_fingerprint: string | null;
          created_at: string;
          id: string;
          link_id: string | null;
          organization_id: string;
          payment_method_id: string;
          provider_account_id: string;
          revoke_reason: string | null;
          revoke_source: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          terms_version: string;
        };
        Insert: {
          accepted_at?: string;
          client_fingerprint?: string | null;
          created_at?: string;
          id?: string;
          link_id?: string | null;
          organization_id: string;
          payment_method_id: string;
          provider_account_id: string;
          revoke_reason?: string | null;
          revoke_source?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          terms_version: string;
        };
        Update: {
          accepted_at?: string;
          client_fingerprint?: string | null;
          created_at?: string;
          id?: string;
          link_id?: string | null;
          organization_id?: string;
          payment_method_id?: string;
          provider_account_id?: string;
          revoke_reason?: string | null;
          revoke_source?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          terms_version?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'card_on_file_authorizations_link_id_fkey';
            columns: ['link_id'];
            isOneToOne: false;
            referencedRelation: 'payment_links';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_link_id_fkey';
            columns: ['link_id'];
            isOneToOne: false;
            referencedRelation: 'v_payment_links';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_payment_method_id_fkey';
            columns: ['payment_method_id'];
            isOneToOne: false;
            referencedRelation: 'provider_payment_methods';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
        ];
      };
      catalog_item_prices: {
        Row: {
          amount: number;
          billing_interval: Database['platform']['Enums']['billing_interval'];
          catalog_item_id: string;
          charge_kind: Database['platform']['Enums']['charge_kind'];
          created_at: string;
          created_by: string | null;
          currency: string;
          id: string;
          market_id: string | null;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          amount: number;
          billing_interval?: Database['platform']['Enums']['billing_interval'];
          catalog_item_id: string;
          charge_kind?: Database['platform']['Enums']['charge_kind'];
          created_at?: string;
          created_by?: string | null;
          currency: string;
          id?: string;
          market_id?: string | null;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          amount?: number;
          billing_interval?: Database['platform']['Enums']['billing_interval'];
          catalog_item_id?: string;
          charge_kind?: Database['platform']['Enums']['charge_kind'];
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          id?: string;
          market_id?: string | null;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'catalog_item_prices_catalog_item_id_fkey';
            columns: ['catalog_item_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'catalog_item_prices_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'catalog_item_prices_currency_fkey';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'catalog_item_prices_market_id_fkey';
            columns: ['market_id'];
            isOneToOne: false;
            referencedRelation: 'markets';
            referencedColumns: ['id'];
          },
        ];
      };
      catalog_items: {
        Row: {
          available: boolean;
          billing_model: string;
          code: string;
          created_at: string;
          credit_pack_credits: number | null;
          currency: string;
          description: string | null;
          id: string;
          item_type: string;
          lifecycle_status: string;
          name: string;
          per_unit_source: string | null;
          price_month: number;
          saas_product_id: string | null;
          scope: string;
          updated_at: string;
          usage_meter_id: string | null;
        };
        Insert: {
          available?: boolean;
          billing_model: string;
          code: string;
          created_at?: string;
          credit_pack_credits?: number | null;
          currency: string;
          description?: string | null;
          id?: string;
          item_type?: string;
          lifecycle_status: string;
          name: string;
          per_unit_source?: string | null;
          price_month?: number;
          saas_product_id?: string | null;
          scope?: string;
          updated_at?: string;
          usage_meter_id?: string | null;
        };
        Update: {
          available?: boolean;
          billing_model?: string;
          code?: string;
          created_at?: string;
          credit_pack_credits?: number | null;
          currency?: string;
          description?: string | null;
          id?: string;
          item_type?: string;
          lifecycle_status?: string;
          name?: string;
          per_unit_source?: string | null;
          price_month?: number;
          saas_product_id?: string | null;
          scope?: string;
          updated_at?: string;
          usage_meter_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'catalog_items_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'catalog_items_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'catalog_items_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'catalog_items_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'catalog_items_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'catalog_items_usage_meter_id_fkey';
            columns: ['usage_meter_id'];
            isOneToOne: false;
            referencedRelation: 'usage_meters';
            referencedColumns: ['id'];
          },
        ];
      };
      commercial_cutover_events: {
        Row: {
          actor_user_id: string | null;
          axis: string;
          from_state: string;
          id: number;
          occurred_at: string;
          product_integration_id: string;
          reason: string;
          to_state: string;
        };
        Insert: {
          actor_user_id?: string | null;
          axis: string;
          from_state: string;
          id?: never;
          occurred_at?: string;
          product_integration_id: string;
          reason: string;
          to_state: string;
        };
        Update: {
          actor_user_id?: string | null;
          axis?: string;
          from_state?: string;
          id?: never;
          occurred_at?: string;
          product_integration_id?: string;
          reason?: string;
          to_state?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'commercial_cutover_events_actor_user_id_fkey';
            columns: ['actor_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commercial_cutover_events_product_integration_id_fkey';
            columns: ['product_integration_id'];
            isOneToOne: false;
            referencedRelation: 'product_integrations';
            referencedColumns: ['id'];
          },
        ];
      };
      commission_events: {
        Row: {
          amount: number;
          applied_rate: number | null;
          attribution_pct: number;
          base_amount: number;
          calculation: NonNullable<Json>;
          commission_rule_id: string;
          created_at: string;
          currency: string;
          earned_on: string;
          id: string;
          invoice_line_id: string | null;
          payment_id: string;
          reversal_of_event_id: string | null;
          reversal_reason: string | null;
          saas_product_id: string;
          sales_agent_id: string;
          sales_attribution_id: string;
          settlement_id: string | null;
          status: Database['platform']['Enums']['commission_status'];
          tenant_id: string | null;
          updated_at: string;
        };
        Insert: {
          amount: number;
          applied_rate?: number | null;
          attribution_pct: number;
          base_amount: number;
          calculation?: NonNullable<Json>;
          commission_rule_id: string;
          created_at?: string;
          currency: string;
          earned_on: string;
          id?: string;
          invoice_line_id?: string | null;
          payment_id: string;
          reversal_of_event_id?: string | null;
          reversal_reason?: string | null;
          saas_product_id: string;
          sales_agent_id: string;
          sales_attribution_id: string;
          settlement_id?: string | null;
          status?: Database['platform']['Enums']['commission_status'];
          tenant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          applied_rate?: number | null;
          attribution_pct?: number;
          base_amount?: number;
          calculation?: NonNullable<Json>;
          commission_rule_id?: string;
          created_at?: string;
          currency?: string;
          earned_on?: string;
          id?: string;
          invoice_line_id?: string | null;
          payment_id?: string;
          reversal_of_event_id?: string | null;
          reversal_reason?: string | null;
          saas_product_id?: string;
          sales_agent_id?: string;
          sales_attribution_id?: string;
          settlement_id?: string | null;
          status?: Database['platform']['Enums']['commission_status'];
          tenant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'commission_events_commission_rule_id_fkey';
            columns: ['commission_rule_id'];
            isOneToOne: false;
            referencedRelation: 'commission_rules';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'commission_events_invoice_line_id_fkey';
            columns: ['invoice_line_id'];
            isOneToOne: false;
            referencedRelation: 'invoice_lines';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['payment_id'];
          },
          {
            foreignKeyName: 'commission_events_reversal_of_event_id_fkey';
            columns: ['reversal_of_event_id'];
            isOneToOne: false;
            referencedRelation: 'commission_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_reversal_of_event_id_fkey';
            columns: ['reversal_of_event_id'];
            isOneToOne: false;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['commission_event_id'];
          },
          {
            foreignKeyName: 'commission_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'commission_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'commission_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'commission_events_sales_agent_id_fkey';
            columns: ['sales_agent_id'];
            isOneToOne: false;
            referencedRelation: 'sales_agents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_sales_attribution_id_fkey';
            columns: ['sales_attribution_id'];
            isOneToOne: false;
            referencedRelation: 'sales_attributions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_settlement_id_fkey';
            columns: ['settlement_id'];
            isOneToOne: false;
            referencedRelation: 'commission_settlements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'commission_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'commission_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      commission_plans: {
        Row: {
          code: string;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          saas_product_id: string | null;
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          saas_product_id?: string | null;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          saas_product_id?: string | null;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'commission_plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'commission_plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'commission_plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      commission_rules: {
        Row: {
          basis: Database['platform']['Enums']['commission_basis'];
          charge_kind: Database['platform']['Enums']['charge_kind'] | null;
          commission_plan_id: string;
          created_at: string;
          currency: string;
          fixed_amount: number | null;
          id: string;
          is_recurring: boolean;
          max_months: number | null;
          max_total_amount: number | null;
          name: string;
          priority: number;
          rate: number | null;
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          basis: Database['platform']['Enums']['commission_basis'];
          charge_kind?: Database['platform']['Enums']['charge_kind'] | null;
          commission_plan_id: string;
          created_at?: string;
          currency: string;
          fixed_amount?: number | null;
          id?: string;
          is_recurring?: boolean;
          max_months?: number | null;
          max_total_amount?: number | null;
          name: string;
          priority?: number;
          rate?: number | null;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          basis?: Database['platform']['Enums']['commission_basis'];
          charge_kind?: Database['platform']['Enums']['charge_kind'] | null;
          commission_plan_id?: string;
          created_at?: string;
          currency?: string;
          fixed_amount?: number | null;
          id?: string;
          is_recurring?: boolean;
          max_months?: number | null;
          max_total_amount?: number | null;
          name?: string;
          priority?: number;
          rate?: number | null;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'commission_rules_commission_plan_id_fkey';
            columns: ['commission_plan_id'];
            isOneToOne: false;
            referencedRelation: 'commission_plans';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_rules_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
        ];
      };
      commission_settlements: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          code: string;
          created_at: string;
          currency: string;
          id: string;
          notes: string | null;
          paid_at: string | null;
          payment_reference: string | null;
          period_end: string;
          period_start: string;
          sales_agent_id: string;
          status: Database['platform']['Enums']['settlement_status'];
          total_amount: number;
          updated_at: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          code: string;
          created_at?: string;
          currency: string;
          id?: string;
          notes?: string | null;
          paid_at?: string | null;
          payment_reference?: string | null;
          period_end: string;
          period_start: string;
          sales_agent_id: string;
          status?: Database['platform']['Enums']['settlement_status'];
          total_amount?: number;
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          code?: string;
          created_at?: string;
          currency?: string;
          id?: string;
          notes?: string | null;
          paid_at?: string | null;
          payment_reference?: string | null;
          period_end?: string;
          period_start?: string;
          sales_agent_id?: string;
          status?: Database['platform']['Enums']['settlement_status'];
          total_amount?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'commission_settlements_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_settlements_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'commission_settlements_sales_agent_id_fkey';
            columns: ['sales_agent_id'];
            isOneToOne: false;
            referencedRelation: 'sales_agents';
            referencedColumns: ['id'];
          },
        ];
      };
      companies: {
        Row: {
          country_code: string;
          created_at: string;
          currency: string;
          erp_code: string | null;
          id: string;
          is_default: boolean;
          market_id: string | null;
          name: string;
          organization_id: string;
          status: Database['platform']['Enums']['entity_status'];
          tax_id: string | null;
          updated_at: string;
        };
        Insert: {
          country_code: string;
          created_at?: string;
          currency: string;
          erp_code?: string | null;
          id?: string;
          is_default?: boolean;
          market_id?: string | null;
          name: string;
          organization_id: string;
          status?: Database['platform']['Enums']['entity_status'];
          tax_id?: string | null;
          updated_at?: string;
        };
        Update: {
          country_code?: string;
          created_at?: string;
          currency?: string;
          erp_code?: string | null;
          id?: string;
          is_default?: boolean;
          market_id?: string | null;
          name?: string;
          organization_id?: string;
          status?: Database['platform']['Enums']['entity_status'];
          tax_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'companies_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'companies_market_id_fkey';
            columns: ['market_id'];
            isOneToOne: false;
            referencedRelation: 'markets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      company_config: {
        Row: {
          company_id: string;
          config: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          config?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          config?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'company_config_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: true;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'company_config_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: true;
            referencedRelation: 'v_company_markets';
            referencedColumns: ['company_id'];
          },
        ];
      };
      control_plane_settings: {
        Row: {
          created_at: string;
          fx_max_rate_age_days: number;
          id: boolean;
          reporting_currency_code: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          fx_max_rate_age_days?: number;
          id?: boolean;
          reporting_currency_code: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          fx_max_rate_age_days?: number;
          id?: boolean;
          reporting_currency_code?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'control_plane_settings_reporting_currency_code_fkey';
            columns: ['reporting_currency_code'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'control_plane_settings_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      cost_allocations: {
        Row: {
          allocation_rule: string;
          cost_entry_id: string;
          created_at: string;
          deployment_target_id: string | null;
          id: string;
          organization_id: string | null;
          saas_product_id: string | null;
          scope: Database['platform']['Enums']['cost_scope'];
          tenant_id: string | null;
          weight: number;
        };
        Insert: {
          allocation_rule?: string;
          cost_entry_id: string;
          created_at?: string;
          deployment_target_id?: string | null;
          id?: string;
          organization_id?: string | null;
          saas_product_id?: string | null;
          scope: Database['platform']['Enums']['cost_scope'];
          tenant_id?: string | null;
          weight?: number;
        };
        Update: {
          allocation_rule?: string;
          cost_entry_id?: string;
          created_at?: string;
          deployment_target_id?: string | null;
          id?: string;
          organization_id?: string | null;
          saas_product_id?: string | null;
          scope?: Database['platform']['Enums']['cost_scope'];
          tenant_id?: string | null;
          weight?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'cost_alloc_deployment_target_fk';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'deployment_targets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_alloc_deployment_target_fk';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_provisioning_targets';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'cost_alloc_deployment_target_fk';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'cost_allocations_cost_entry_id_fkey';
            columns: ['cost_entry_id'];
            isOneToOne: false;
            referencedRelation: 'cost_entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_allocations_cost_entry_id_fkey';
            columns: ['cost_entry_id'];
            isOneToOne: false;
            referencedRelation: 'v_cost_entry_list';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_allocations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_allocations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'cost_allocations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'cost_allocations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'cost_allocations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'cost_allocations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'cost_allocations_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_allocations_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'cost_allocations_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'cost_allocations_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'cost_allocations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_allocations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'cost_allocations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'cost_allocations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      cost_entries: {
        Row: {
          amount: number;
          category: Database['platform']['Enums']['cost_category'];
          created_at: string;
          currency: string;
          description: string;
          id: string;
          is_recurring: boolean;
          metadata: NonNullable<Json>;
          period_end: string;
          period_start: string;
          updated_at: string;
          vendor: string | null;
        };
        Insert: {
          amount: number;
          category: Database['platform']['Enums']['cost_category'];
          created_at?: string;
          currency: string;
          description: string;
          id?: string;
          is_recurring?: boolean;
          metadata?: NonNullable<Json>;
          period_end: string;
          period_start: string;
          updated_at?: string;
          vendor?: string | null;
        };
        Update: {
          amount?: number;
          category?: Database['platform']['Enums']['cost_category'];
          created_at?: string;
          currency?: string;
          description?: string;
          id?: string;
          is_recurring?: boolean;
          metadata?: NonNullable<Json>;
          period_end?: string;
          period_start?: string;
          updated_at?: string;
          vendor?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'cost_entries_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
        ];
      };
      credential_profiles: {
        Row: {
          algorithm: Database['platform']['Enums']['m2m_algorithm'] | null;
          audience: string | null;
          code: string;
          created_at: string;
          enabled: boolean;
          environment: Database['platform']['Enums']['provisioning_environment'];
          id: string;
          issuer: string | null;
          name: string;
          public_key_ref: string | null;
          saas_product_id: string | null;
          secret_configured: boolean | null;
          secret_ref: string | null;
          token_ttl_seconds: number | null;
          type: Database['platform']['Enums']['credential_profile_type'];
          updated_at: string;
        };
        Insert: {
          algorithm?: Database['platform']['Enums']['m2m_algorithm'] | null;
          audience?: string | null;
          code: string;
          created_at?: string;
          enabled?: boolean;
          environment: Database['platform']['Enums']['provisioning_environment'];
          id?: string;
          issuer?: string | null;
          name: string;
          public_key_ref?: string | null;
          saas_product_id?: string | null;
          secret_configured?: never;
          secret_ref?: string | null;
          token_ttl_seconds?: number | null;
          type: Database['platform']['Enums']['credential_profile_type'];
          updated_at?: string;
        };
        Update: {
          algorithm?: Database['platform']['Enums']['m2m_algorithm'] | null;
          audience?: string | null;
          code?: string;
          created_at?: string;
          enabled?: boolean;
          environment?: Database['platform']['Enums']['provisioning_environment'];
          id?: string;
          issuer?: string | null;
          name?: string;
          public_key_ref?: string | null;
          saas_product_id?: string | null;
          secret_configured?: never;
          secret_ref?: string | null;
          token_ttl_seconds?: number | null;
          type?: Database['platform']['Enums']['credential_profile_type'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'credential_profiles_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'credential_profiles_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'credential_profiles_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'credential_profiles_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      currencies: {
        Row: {
          code: string;
          created_at: string;
          decimals: number;
          name: string;
          status: Database['platform']['Enums']['entity_status'];
          symbol: string | null;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          decimals: number;
          name: string;
          status?: Database['platform']['Enums']['entity_status'];
          symbol?: string | null;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          decimals?: number;
          name?: string;
          status?: Database['platform']['Enums']['entity_status'];
          symbol?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      deployment_targets: {
        Row: {
          base_url: string | null;
          code: string;
          cost_center: string | null;
          created_at: string;
          credential_profile_id: string | null;
          deployment_mode: Database['platform']['Enums']['deployment_mode'];
          environment: Database['platform']['Enums']['environment_kind'];
          health_checked_at: string | null;
          health_detail: string | null;
          health_status: Database['platform']['Enums']['deployment_health'];
          id: string;
          metadata: NonNullable<Json>;
          name: string;
          owner_organization_id: string | null;
          product_integration_id: string | null;
          provider: Database['platform']['Enums']['infra_provider'];
          provider_project_ref: string | null;
          provisioning_enabled: boolean;
          provisioning_environment:
            Database['platform']['Enums']['provisioning_environment'] | null;
          provisioning_policy: Database['platform']['Enums']['provisioning_policy'] | null;
          provisioning_status: Database['platform']['Enums']['deployment_target_status'];
          region: string | null;
          retry_count: number;
          saas_product_id: string | null;
          status: Database['platform']['Enums']['entity_status'];
          timeout_ms: number;
          updated_at: string;
        };
        Insert: {
          base_url?: string | null;
          code: string;
          cost_center?: string | null;
          created_at?: string;
          credential_profile_id?: string | null;
          deployment_mode: Database['platform']['Enums']['deployment_mode'];
          environment?: Database['platform']['Enums']['environment_kind'];
          health_checked_at?: string | null;
          health_detail?: string | null;
          health_status?: Database['platform']['Enums']['deployment_health'];
          id?: string;
          metadata?: NonNullable<Json>;
          name: string;
          owner_organization_id?: string | null;
          product_integration_id?: string | null;
          provider?: Database['platform']['Enums']['infra_provider'];
          provider_project_ref?: string | null;
          provisioning_enabled?: boolean;
          provisioning_environment?:
            Database['platform']['Enums']['provisioning_environment'] | null;
          provisioning_policy?: Database['platform']['Enums']['provisioning_policy'] | null;
          provisioning_status?: Database['platform']['Enums']['deployment_target_status'];
          region?: string | null;
          retry_count?: number;
          saas_product_id?: string | null;
          status?: Database['platform']['Enums']['entity_status'];
          timeout_ms?: number;
          updated_at?: string;
        };
        Update: {
          base_url?: string | null;
          code?: string;
          cost_center?: string | null;
          created_at?: string;
          credential_profile_id?: string | null;
          deployment_mode?: Database['platform']['Enums']['deployment_mode'];
          environment?: Database['platform']['Enums']['environment_kind'];
          health_checked_at?: string | null;
          health_detail?: string | null;
          health_status?: Database['platform']['Enums']['deployment_health'];
          id?: string;
          metadata?: NonNullable<Json>;
          name?: string;
          owner_organization_id?: string | null;
          product_integration_id?: string | null;
          provider?: Database['platform']['Enums']['infra_provider'];
          provider_project_ref?: string | null;
          provisioning_enabled?: boolean;
          provisioning_environment?:
            Database['platform']['Enums']['provisioning_environment'] | null;
          provisioning_policy?: Database['platform']['Enums']['provisioning_policy'] | null;
          provisioning_status?: Database['platform']['Enums']['deployment_target_status'];
          region?: string | null;
          retry_count?: number;
          saas_product_id?: string | null;
          status?: Database['platform']['Enums']['entity_status'];
          timeout_ms?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deployment_targets_credential_profile_id_fkey';
            columns: ['credential_profile_id'];
            isOneToOne: false;
            referencedRelation: 'credential_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'deployment_targets_product_integration_id_fkey';
            columns: ['product_integration_id'];
            isOneToOne: false;
            referencedRelation: 'product_integrations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deployment_targets_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deployment_targets_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'deployment_targets_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'deployment_targets_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      entitlement_desired_state: {
        Row: {
          created_at: string;
          desired_dirty: boolean;
          desired_revision: number;
          dirty_since: string | null;
          last_change_at: string | null;
          last_change_reason: string | null;
          saas_product_id: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          desired_dirty?: boolean;
          desired_revision?: number;
          dirty_since?: string | null;
          last_change_at?: string | null;
          last_change_reason?: string | null;
          saas_product_id: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          desired_dirty?: boolean;
          desired_revision?: number;
          dirty_since?: string | null;
          last_change_at?: string | null;
          last_change_reason?: string | null;
          saas_product_id?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'entitlement_desired_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_desired_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_desired_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_desired_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_desired_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_desired_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'entitlement_desired_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'entitlement_desired_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      entitlement_grants: {
        Row: {
          capability_id: string;
          catalog_item_id: string | null;
          close_reason: string | null;
          closed_by: string | null;
          created_at: string;
          created_by: string | null;
          grant_value: NonNullable<Json>;
          id: string;
          plan_id: string | null;
          source_type: string;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          capability_id: string;
          catalog_item_id?: string | null;
          close_reason?: string | null;
          closed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          grant_value: NonNullable<Json>;
          id?: string;
          plan_id?: string | null;
          source_type: string;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          capability_id?: string;
          catalog_item_id?: string | null;
          close_reason?: string | null;
          closed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          grant_value?: NonNullable<Json>;
          id?: string;
          plan_id?: string | null;
          source_type?: string;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'entitlement_grants_capability_id_fkey';
            columns: ['capability_id'];
            isOneToOne: false;
            referencedRelation: 'product_capabilities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_grants_catalog_item_id_fkey';
            columns: ['catalog_item_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_grants_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_grants_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_grants_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
        ];
      };
      entitlement_registry_checks: {
        Row: {
          checked_at: string;
          drift: boolean;
          id: number;
          manifest_version: string | null;
          missing_in_manifest: string[];
          missing_in_registry: string[];
          saas_product_id: string;
        };
        Insert: {
          checked_at?: string;
          drift: boolean;
          id?: never;
          manifest_version?: string | null;
          missing_in_manifest?: string[];
          missing_in_registry?: string[];
          saas_product_id: string;
        };
        Update: {
          checked_at?: string;
          drift?: boolean;
          id?: never;
          manifest_version?: string | null;
          missing_in_manifest?: string[];
          missing_in_registry?: string[];
          saas_product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'entitlement_registry_checks_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_registry_checks_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_registry_checks_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_registry_checks_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      entitlement_snapshots: {
        Row: {
          checksum: string;
          content_checksum: string;
          correlation_id: string;
          created_at: string;
          desired_revision: number;
          document: NonNullable<Json>;
          effective_at: string;
          id: string;
          idempotency_key: string;
          issued_at: string;
          previous_version: number | null;
          saas_product_id: string;
          size_bytes: number;
          snapshot_version: number;
          tenant_id: string;
        };
        Insert: {
          checksum: string;
          content_checksum: string;
          correlation_id: string;
          created_at?: string;
          desired_revision?: number;
          document: NonNullable<Json>;
          effective_at: string;
          id?: string;
          idempotency_key: string;
          issued_at?: string;
          previous_version?: number | null;
          saas_product_id: string;
          size_bytes: number;
          snapshot_version: number;
          tenant_id: string;
        };
        Update: {
          checksum?: string;
          content_checksum?: string;
          correlation_id?: string;
          created_at?: string;
          desired_revision?: number;
          document?: NonNullable<Json>;
          effective_at?: string;
          id?: string;
          idempotency_key?: string;
          issued_at?: string;
          previous_version?: number | null;
          saas_product_id?: string;
          size_bytes?: number;
          snapshot_version?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'entitlement_snapshots_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_snapshots_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_snapshots_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_snapshots_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_snapshots_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_snapshots_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'entitlement_snapshots_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'entitlement_snapshots_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      entitlement_sync_attempts: {
        Row: {
          detail: NonNullable<Json>;
          error_code: string | null;
          http_status: number | null;
          id: number;
          occurred_at: string;
          operation: string;
          outcome: string;
          saas_product_id: string;
          snapshot_version: number | null;
          state_after: string | null;
          state_before: string | null;
          tenant_id: string;
          worker: string | null;
        };
        Insert: {
          detail?: NonNullable<Json>;
          error_code?: string | null;
          http_status?: number | null;
          id?: never;
          occurred_at?: string;
          operation: string;
          outcome: string;
          saas_product_id: string;
          snapshot_version?: number | null;
          state_after?: string | null;
          state_before?: string | null;
          tenant_id: string;
          worker?: string | null;
        };
        Update: {
          detail?: NonNullable<Json>;
          error_code?: string | null;
          http_status?: number | null;
          id?: never;
          occurred_at?: string;
          operation?: string;
          outcome?: string;
          saas_product_id?: string;
          snapshot_version?: number | null;
          state_after?: string | null;
          state_before?: string | null;
          tenant_id?: string;
          worker?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'entitlement_sync_attempts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_sync_attempts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_attempts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_attempts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_attempts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_sync_attempts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_attempts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_attempts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      entitlement_sync_state: {
        Row: {
          applied_checksum: string | null;
          applied_status: string;
          applied_version: number | null;
          cohort_state: string | null;
          consecutive_failures: number;
          created_at: string;
          desired_checksum: string | null;
          desired_version: number | null;
          last_push_at: string | null;
          last_push_result: string | null;
          last_pushed_version: number | null;
          last_verified_at: string | null;
          lease_owner: string | null;
          lease_until: string | null;
          next_attempt_at: string;
          pushing_version: number | null;
          saas_product_id: string;
          state: string;
          state_changed_at: string;
          state_reason: string | null;
          tenant_id: string;
          unknown_capabilities: string[];
          updated_at: string;
        };
        Insert: {
          applied_checksum?: string | null;
          applied_status?: string;
          applied_version?: number | null;
          cohort_state?: string | null;
          consecutive_failures?: number;
          created_at?: string;
          desired_checksum?: string | null;
          desired_version?: number | null;
          last_push_at?: string | null;
          last_push_result?: string | null;
          last_pushed_version?: number | null;
          last_verified_at?: string | null;
          lease_owner?: string | null;
          lease_until?: string | null;
          next_attempt_at?: string;
          pushing_version?: number | null;
          saas_product_id: string;
          state?: string;
          state_changed_at?: string;
          state_reason?: string | null;
          tenant_id: string;
          unknown_capabilities?: string[];
          updated_at?: string;
        };
        Update: {
          applied_checksum?: string | null;
          applied_status?: string;
          applied_version?: number | null;
          cohort_state?: string | null;
          consecutive_failures?: number;
          created_at?: string;
          desired_checksum?: string | null;
          desired_version?: number | null;
          last_push_at?: string | null;
          last_push_result?: string | null;
          last_pushed_version?: number | null;
          last_verified_at?: string | null;
          lease_owner?: string | null;
          lease_until?: string | null;
          next_attempt_at?: string;
          pushing_version?: number | null;
          saas_product_id?: string;
          state?: string;
          state_changed_at?: string;
          state_reason?: string | null;
          tenant_id?: string;
          unknown_capabilities?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'entitlement_sync_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      exchange_rates: {
        Row: {
          base_currency: string;
          created_at: string;
          created_by: string | null;
          id: string;
          is_demo: boolean;
          notes: string | null;
          quote_currency: string;
          rate: number;
          rate_date: string;
          source: Database['platform']['Enums']['fx_rate_source'];
          status: Database['platform']['Enums']['fx_rate_status'];
          status_changed_at: string | null;
          status_changed_by: string | null;
          status_reason: string | null;
          superseded_by: string | null;
          updated_at: string;
        };
        Insert: {
          base_currency: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_demo?: boolean;
          notes?: string | null;
          quote_currency: string;
          rate: number;
          rate_date: string;
          source?: Database['platform']['Enums']['fx_rate_source'];
          status?: Database['platform']['Enums']['fx_rate_status'];
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          status_reason?: string | null;
          superseded_by?: string | null;
          updated_at?: string;
        };
        Update: {
          base_currency?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_demo?: boolean;
          notes?: string | null;
          quote_currency?: string;
          rate?: number;
          rate_date?: string;
          source?: Database['platform']['Enums']['fx_rate_source'];
          status?: Database['platform']['Enums']['fx_rate_status'];
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          status_reason?: string | null;
          superseded_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'exchange_rates_base_currency_fkey';
            columns: ['base_currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'exchange_rates_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exchange_rates_quote_currency_fkey';
            columns: ['quote_currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'exchange_rates_status_changed_by_fkey';
            columns: ['status_changed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exchange_rates_superseded_by_fkey';
            columns: ['superseded_by'];
            isOneToOne: false;
            referencedRelation: 'exchange_rates';
            referencedColumns: ['id'];
          },
        ];
      };
      invoice_charge_locks: {
        Row: {
          claimed_at: string;
          expires_at: string;
          holder: string;
          holder_ref: string | null;
          invoice_id: string;
          lock_id: string;
          outcome_code: string | null;
          released_at: string | null;
          status: string;
        };
        Insert: {
          claimed_at?: string;
          expires_at: string;
          holder: string;
          holder_ref?: string | null;
          invoice_id: string;
          lock_id?: string;
          outcome_code?: string | null;
          released_at?: string | null;
          status?: string;
        };
        Update: {
          claimed_at?: string;
          expires_at?: string;
          holder?: string;
          holder_ref?: string | null;
          invoice_id?: string;
          lock_id?: string;
          outcome_code?: string | null;
          released_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_charge_locks_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: true;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_charge_locks_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: true;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'invoice_charge_locks_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: true;
            referencedRelation: 'v_collected_revenue';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'invoice_charge_locks_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: true;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'invoice_charge_locks_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: true;
            referencedRelation: 'v_discount_sign_legacy_invoices';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'invoice_charge_locks_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: true;
            referencedRelation: 'v_invoice_balances';
            referencedColumns: ['invoice_id'];
          },
        ];
      };
      invoice_lines: {
        Row: {
          ai_credit_entry_id: string | null;
          ai_credit_pool_key: string | null;
          amount: number | null;
          catalog_item_id: string | null;
          charge_kind: Database['platform']['Enums']['charge_kind'];
          corrects_line_id: string | null;
          created_at: string;
          currency: string;
          description: string;
          id: string;
          invoice_id: string;
          is_recurring: boolean;
          meter_code: string | null;
          price_ref: string | null;
          quantity: number;
          saas_product_id: string | null;
          subscription_item_id: string | null;
          tenant_id: string | null;
          unit_amount: number;
          usage_aggregate_id: string | null;
          usage_basis: string | null;
          usage_period_start: string | null;
          usage_source_hash: string | null;
        };
        Insert: {
          ai_credit_entry_id?: string | null;
          ai_credit_pool_key?: string | null;
          amount?: never;
          catalog_item_id?: string | null;
          charge_kind: Database['platform']['Enums']['charge_kind'];
          corrects_line_id?: string | null;
          created_at?: string;
          currency: string;
          description: string;
          id?: string;
          invoice_id: string;
          is_recurring?: boolean;
          meter_code?: string | null;
          price_ref?: string | null;
          quantity?: number;
          saas_product_id?: string | null;
          subscription_item_id?: string | null;
          tenant_id?: string | null;
          unit_amount: number;
          usage_aggregate_id?: string | null;
          usage_basis?: string | null;
          usage_period_start?: string | null;
          usage_source_hash?: string | null;
        };
        Update: {
          ai_credit_entry_id?: string | null;
          ai_credit_pool_key?: string | null;
          amount?: never;
          catalog_item_id?: string | null;
          charge_kind?: Database['platform']['Enums']['charge_kind'];
          corrects_line_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string;
          id?: string;
          invoice_id?: string;
          is_recurring?: boolean;
          meter_code?: string | null;
          price_ref?: string | null;
          quantity?: number;
          saas_product_id?: string | null;
          subscription_item_id?: string | null;
          tenant_id?: string | null;
          unit_amount?: number;
          usage_aggregate_id?: string | null;
          usage_basis?: string | null;
          usage_period_start?: string | null;
          usage_source_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_lines_catalog_item_id_fkey';
            columns: ['catalog_item_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_lines_corrects_line_id_fkey';
            columns: ['corrects_line_id'];
            isOneToOne: false;
            referencedRelation: 'invoice_lines';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_lines_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'invoice_lines_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_lines_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'invoice_lines_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_revenue';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'invoice_lines_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'invoice_lines_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_discount_sign_legacy_invoices';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'invoice_lines_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_invoice_balances';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'invoice_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'invoice_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'invoice_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'invoice_lines_subscription_item_id_fkey';
            columns: ['subscription_item_id'];
            isOneToOne: false;
            referencedRelation: 'subscription_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'invoice_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'invoice_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'invoice_lines_usage_aggregate_id_fkey';
            columns: ['usage_aggregate_id'];
            isOneToOne: false;
            referencedRelation: 'usage_period_aggregates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_lines_usage_aggregate_id_fkey';
            columns: ['usage_aggregate_id'];
            isOneToOne: false;
            referencedRelation: 'v_usage_period_aggregates';
            referencedColumns: ['id'];
          },
        ];
      };
      invoices: {
        Row: {
          company_id: string | null;
          created_at: string;
          currency: string;
          customer_organization_id: string;
          due_date: string | null;
          id: string;
          issue_date: string | null;
          metadata: NonNullable<Json>;
          notes: string | null;
          number: string;
          period_end: string | null;
          period_start: string | null;
          status: Database['platform']['Enums']['invoice_status'];
          subscription_id: string | null;
          subtotal: number;
          tax_amount: number;
          total: number;
          updated_at: string;
        };
        Insert: {
          company_id?: string | null;
          created_at?: string;
          currency: string;
          customer_organization_id: string;
          due_date?: string | null;
          id?: string;
          issue_date?: string | null;
          metadata?: NonNullable<Json>;
          notes?: string | null;
          number: string;
          period_end?: string | null;
          period_start?: string | null;
          status?: Database['platform']['Enums']['invoice_status'];
          subscription_id?: string | null;
          subtotal?: number;
          tax_amount?: number;
          total?: number;
          updated_at?: string;
        };
        Update: {
          company_id?: string | null;
          created_at?: string;
          currency?: string;
          customer_organization_id?: string;
          due_date?: string | null;
          id?: string;
          issue_date?: string | null;
          metadata?: NonNullable<Json>;
          notes?: string | null;
          number?: string;
          period_end?: string | null;
          period_start?: string | null;
          status?: Database['platform']['Enums']['invoice_status'];
          subscription_id?: string | null;
          subtotal?: number;
          tax_amount?: number;
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'v_company_markets';
            referencedColumns: ['company_id'];
          },
          {
            foreignKeyName: 'invoices_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
        ];
      };
      m2m_jti_replay: {
        Row: {
          expires_at: string;
          issuer: string;
          jti: string;
          used_at: string;
        };
        Insert: {
          expires_at: string;
          issuer: string;
          jti: string;
          used_at?: string;
        };
        Update: {
          expires_at?: string;
          issuer?: string;
          jti?: string;
          used_at?: string;
        };
        Relationships: [];
      };
      market_currencies: {
        Row: {
          created_at: string;
          currency_code: string;
          market_id: string;
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency_code: string;
          market_id: string;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency_code?: string;
          market_id?: string;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'market_currencies_currency_code_fkey';
            columns: ['currency_code'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'market_currencies_market_id_fkey';
            columns: ['market_id'];
            isOneToOne: false;
            referencedRelation: 'markets';
            referencedColumns: ['id'];
          },
        ];
      };
      markets: {
        Row: {
          code: string;
          country_code: string;
          created_at: string;
          default_currency_code: string;
          id: string;
          name: string;
          sort_order: number;
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
        };
        Insert: {
          code: string;
          country_code: string;
          created_at?: string;
          default_currency_code: string;
          id?: string;
          name: string;
          sort_order?: number;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
        };
        Update: {
          code?: string;
          country_code?: string;
          created_at?: string;
          default_currency_code?: string;
          id?: string;
          name?: string;
          sort_order?: number;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'markets_default_currency_code_fkey';
            columns: ['default_currency_code'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
        ];
      };
      org_config: {
        Row: {
          config: NonNullable<Json>;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          config?: NonNullable<Json>;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          config?: NonNullable<Json>;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'org_config_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'org_config_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'org_config_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'org_config_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'org_config_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'org_config_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      organization_capabilities: {
        Row: {
          capability: Database['platform']['Enums']['org_capability'];
          granted_at: string;
          notes: string | null;
          organization_id: string;
        };
        Insert: {
          capability: Database['platform']['Enums']['org_capability'];
          granted_at?: string;
          notes?: string | null;
          organization_id: string;
        };
        Update: {
          capability?: Database['platform']['Enums']['org_capability'];
          granted_at?: string;
          notes?: string | null;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_capabilities_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_capabilities_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_capabilities_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_capabilities_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_capabilities_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'organization_capabilities_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      organization_memberships: {
        Row: {
          company_id: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          organization_id: string;
          role: Database['platform']['Enums']['org_role'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          company_id?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          organization_id: string;
          role?: Database['platform']['Enums']['org_role'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          company_id?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          organization_id?: string;
          role?: Database['platform']['Enums']['org_role'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_memberships_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_memberships_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'v_company_markets';
            referencedColumns: ['company_id'];
          },
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'organization_memberships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_product_agreements: {
        Row: {
          allowed_deployment_modes: Database['platform']['Enums']['deployment_mode'][];
          allowed_tenant_types: Database['platform']['Enums']['tenant_type'][];
          billing_responsibility: Database['platform']['Enums']['billing_responsibility'];
          can_manage_tenants: boolean;
          can_resell: boolean;
          created_at: string;
          default_deployment_mode: Database['platform']['Enums']['deployment_mode'];
          id: string;
          margin_rate: number;
          max_tenants: number | null;
          notes: string | null;
          organization_id: string;
          platform_fee_currency: string | null;
          platform_fee_fixed_amount: number | null;
          platform_fee_model: string;
          platform_fee_rate: number | null;
          saas_product_id: string;
          status: Database['platform']['Enums']['entity_status'];
          terms: NonNullable<Json>;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          allowed_deployment_modes?: Database['platform']['Enums']['deployment_mode'][];
          allowed_tenant_types?: Database['platform']['Enums']['tenant_type'][];
          billing_responsibility?: Database['platform']['Enums']['billing_responsibility'];
          can_manage_tenants?: boolean;
          can_resell?: boolean;
          created_at?: string;
          default_deployment_mode?: Database['platform']['Enums']['deployment_mode'];
          id?: string;
          margin_rate?: number;
          max_tenants?: number | null;
          notes?: string | null;
          organization_id: string;
          platform_fee_currency?: string | null;
          platform_fee_fixed_amount?: number | null;
          platform_fee_model?: string;
          platform_fee_rate?: number | null;
          saas_product_id: string;
          status?: Database['platform']['Enums']['entity_status'];
          terms?: NonNullable<Json>;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          allowed_deployment_modes?: Database['platform']['Enums']['deployment_mode'][];
          allowed_tenant_types?: Database['platform']['Enums']['tenant_type'][];
          billing_responsibility?: Database['platform']['Enums']['billing_responsibility'];
          can_manage_tenants?: boolean;
          can_resell?: boolean;
          created_at?: string;
          default_deployment_mode?: Database['platform']['Enums']['deployment_mode'];
          id?: string;
          margin_rate?: number;
          max_tenants?: number | null;
          notes?: string | null;
          organization_id?: string;
          platform_fee_currency?: string | null;
          platform_fee_fixed_amount?: number | null;
          platform_fee_model?: string;
          platform_fee_rate?: number | null;
          saas_product_id?: string;
          status?: Database['platform']['Enums']['entity_status'];
          terms?: NonNullable<Json>;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_platform_fee_currency_fkey';
            columns: ['platform_fee_currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'organization_product_agreements_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      organization_relationships: {
        Row: {
          child_organization_id: string;
          created_at: string;
          id: string;
          notes: string | null;
          parent_organization_id: string;
          relationship_type: Database['platform']['Enums']['org_relationship_type'];
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          child_organization_id: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          parent_organization_id: string;
          relationship_type: Database['platform']['Enums']['org_relationship_type'];
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          child_organization_id?: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          parent_organization_id?: string;
          relationship_type?: Database['platform']['Enums']['org_relationship_type'];
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_relationships_child_organization_id_fkey';
            columns: ['child_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_relationships_child_organization_id_fkey';
            columns: ['child_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_relationships_child_organization_id_fkey';
            columns: ['child_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_relationships_child_organization_id_fkey';
            columns: ['child_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_relationships_child_organization_id_fkey';
            columns: ['child_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'organization_relationships_child_organization_id_fkey';
            columns: ['child_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'organization_relationships_parent_organization_id_fkey';
            columns: ['parent_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_relationships_parent_organization_id_fkey';
            columns: ['parent_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_relationships_parent_organization_id_fkey';
            columns: ['parent_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_relationships_parent_organization_id_fkey';
            columns: ['parent_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_relationships_parent_organization_id_fkey';
            columns: ['parent_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'organization_relationships_parent_organization_id_fkey';
            columns: ['parent_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      organizations: {
        Row: {
          accent_color: string | null;
          archived_at: string | null;
          billing_address: string | null;
          billing_city: string | null;
          billing_email: string | null;
          billing_first_name: string | null;
          billing_last_name: string | null;
          billing_phone: string | null;
          brand_slug: string | null;
          country_code: string;
          created_at: string;
          display_name: string;
          id: string;
          kind: Database['platform']['Enums']['org_kind'];
          legal_name: string;
          logo_url: string | null;
          metadata: NonNullable<Json>;
          slug: string;
          status: Database['platform']['Enums']['entity_status'];
          tax_id: string | null;
          updated_at: string;
          white_label: boolean;
        };
        Insert: {
          accent_color?: string | null;
          archived_at?: string | null;
          billing_address?: string | null;
          billing_city?: string | null;
          billing_email?: string | null;
          billing_first_name?: string | null;
          billing_last_name?: string | null;
          billing_phone?: string | null;
          brand_slug?: string | null;
          country_code: string;
          created_at?: string;
          display_name: string;
          id?: string;
          kind?: Database['platform']['Enums']['org_kind'];
          legal_name: string;
          logo_url?: string | null;
          metadata?: NonNullable<Json>;
          slug: string;
          status?: Database['platform']['Enums']['entity_status'];
          tax_id?: string | null;
          updated_at?: string;
          white_label?: boolean;
        };
        Update: {
          accent_color?: string | null;
          archived_at?: string | null;
          billing_address?: string | null;
          billing_city?: string | null;
          billing_email?: string | null;
          billing_first_name?: string | null;
          billing_last_name?: string | null;
          billing_phone?: string | null;
          brand_slug?: string | null;
          country_code?: string;
          created_at?: string;
          display_name?: string;
          id?: string;
          kind?: Database['platform']['Enums']['org_kind'];
          legal_name?: string;
          logo_url?: string | null;
          metadata?: NonNullable<Json>;
          slug?: string;
          status?: Database['platform']['Enums']['entity_status'];
          tax_id?: string | null;
          updated_at?: string;
          white_label?: boolean;
        };
        Relationships: [];
      };
      partner_fee_statement_lines: {
        Row: {
          agreement_id: string;
          base_list_amount: number;
          basis: NonNullable<Json>;
          created_at: string;
          currency: string;
          fee_amount: number;
          fee_fixed_amount: number | null;
          fee_rate: number | null;
          id: string;
          line_kind: string;
          saas_product_id: string;
          statement_id: string;
          subscription_id: string | null;
          tenant_id: string;
        };
        Insert: {
          agreement_id: string;
          base_list_amount?: number;
          basis?: NonNullable<Json>;
          created_at?: string;
          currency: string;
          fee_amount: number;
          fee_fixed_amount?: number | null;
          fee_rate?: number | null;
          id?: string;
          line_kind: string;
          saas_product_id: string;
          statement_id: string;
          subscription_id?: string | null;
          tenant_id: string;
        };
        Update: {
          agreement_id?: string;
          base_list_amount?: number;
          basis?: NonNullable<Json>;
          created_at?: string;
          currency?: string;
          fee_amount?: number;
          fee_fixed_amount?: number | null;
          fee_rate?: number | null;
          id?: string;
          line_kind?: string;
          saas_product_id?: string;
          statement_id?: string;
          subscription_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'partner_fee_statement_lines_agreement_id_fkey';
            columns: ['agreement_id'];
            isOneToOne: false;
            referencedRelation: 'organization_product_agreements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_agreement_id_fkey';
            columns: ['agreement_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_agreements';
            referencedColumns: ['agreement_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_currency_fkey';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_statement_id_fkey';
            columns: ['statement_id'];
            isOneToOne: false;
            referencedRelation: 'partner_fee_statements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_statement_id_fkey';
            columns: ['statement_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_fee_statements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      partner_fee_statements: {
        Row: {
          base_total: number;
          computed_at: string;
          computed_by: string | null;
          created_at: string;
          currency: string;
          fee_total: number;
          id: string;
          invoice_id: string | null;
          issued_at: string | null;
          issued_by: string | null;
          line_count: number;
          partner_organization_id: string;
          period_end: string;
          period_start: string;
          source_hash: string;
          status: string;
          tenant_count: number;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        Insert: {
          base_total?: number;
          computed_at?: string;
          computed_by?: string | null;
          created_at?: string;
          currency: string;
          fee_total?: number;
          id?: string;
          invoice_id?: string | null;
          issued_at?: string | null;
          issued_by?: string | null;
          line_count?: number;
          partner_organization_id: string;
          period_end: string;
          period_start: string;
          source_hash: string;
          status?: string;
          tenant_count?: number;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          base_total?: number;
          computed_at?: string;
          computed_by?: string | null;
          created_at?: string;
          currency?: string;
          fee_total?: number;
          id?: string;
          invoice_id?: string | null;
          issued_at?: string | null;
          issued_by?: string | null;
          line_count?: number;
          partner_organization_id?: string;
          period_end?: string;
          period_start?: string;
          source_hash?: string;
          status?: string;
          tenant_count?: number;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'partner_fee_statements_computed_by_fkey';
            columns: ['computed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_currency_fkey';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_revenue';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_discount_sign_legacy_invoices';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_invoice_balances';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_issued_by_fkey';
            columns: ['issued_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_voided_by_fkey';
            columns: ['voided_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      payment_charge_attempts: {
        Row: {
          amount: number;
          attempt_no: number;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          error_code: string | null;
          external_charge_id: string | null;
          id: string;
          idempotency_key: string;
          invoice_id: string;
          next_retry_at: string | null;
          payment_id: string | null;
          payment_method_id: string;
          provider_account_id: string;
          status: string;
          trigger_source: string;
        };
        Insert: {
          amount: number;
          attempt_no: number;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency: string;
          error_code?: string | null;
          external_charge_id?: string | null;
          id?: string;
          idempotency_key: string;
          invoice_id: string;
          next_retry_at?: string | null;
          payment_id?: string | null;
          payment_method_id: string;
          provider_account_id: string;
          status?: string;
          trigger_source: string;
        };
        Update: {
          amount?: number;
          attempt_no?: number;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          error_code?: string | null;
          external_charge_id?: string | null;
          id?: string;
          idempotency_key?: string;
          invoice_id?: string;
          next_retry_at?: string | null;
          payment_id?: string | null;
          payment_method_id?: string;
          provider_account_id?: string;
          status?: string;
          trigger_source?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_charge_attempts_currency_fkey';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_revenue';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_discount_sign_legacy_invoices';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_invoice_balances';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['payment_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_payment_method_id_fkey';
            columns: ['payment_method_id'];
            isOneToOne: false;
            referencedRelation: 'provider_payment_methods';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
        ];
      };
      payment_link_events: {
        Row: {
          amount: number | null;
          client_fingerprint: string | null;
          created_at: string;
          currency: string | null;
          error_code: string | null;
          external_id: string | null;
          id: string;
          invoice_id: string | null;
          kind: string;
          link_id: string;
        };
        Insert: {
          amount?: number | null;
          client_fingerprint?: string | null;
          created_at?: string;
          currency?: string | null;
          error_code?: string | null;
          external_id?: string | null;
          id?: string;
          invoice_id?: string | null;
          kind: string;
          link_id: string;
        };
        Update: {
          amount?: number | null;
          client_fingerprint?: string | null;
          created_at?: string;
          currency?: string | null;
          error_code?: string | null;
          external_id?: string | null;
          id?: string;
          invoice_id?: string | null;
          kind?: string;
          link_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_link_events_currency_fkey';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'payment_link_events_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_link_events_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_link_events_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_revenue';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_link_events_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_link_events_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_discount_sign_legacy_invoices';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_link_events_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_invoice_balances';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_link_events_link_id_fkey';
            columns: ['link_id'];
            isOneToOne: false;
            referencedRelation: 'payment_links';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_link_events_link_id_fkey';
            columns: ['link_id'];
            isOneToOne: false;
            referencedRelation: 'v_payment_links';
            referencedColumns: ['id'];
          },
        ];
      };
      payment_links: {
        Row: {
          access_count: number;
          allow_card_enrollment: boolean;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          last_accessed_at: string | null;
          organization_id: string;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          token_hash: string;
          token_hint: string;
          payment_link_error: string | null;
        };
        Insert: {
          access_count?: number;
          allow_card_enrollment?: boolean;
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          last_accessed_at?: string | null;
          organization_id: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          token_hash: string;
          token_hint: string;
        };
        Update: {
          access_count?: number;
          allow_card_enrollment?: boolean;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          last_accessed_at?: string | null;
          organization_id?: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          token_hash?: string;
          token_hint?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      payment_provider_account_currencies: {
        Row: {
          created_at: string;
          currency_code: string;
          provider_account_id: string;
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency_code: string;
          provider_account_id: string;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency_code?: string;
          provider_account_id?: string;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_provider_account_currencies_currency_code_fkey';
            columns: ['currency_code'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'payment_provider_account_currencies_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_provider_account_currencies_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
        ];
      };
      payment_provider_accounts: {
        Row: {
          api_base_url: string | null;
          code: string;
          country_code: string;
          created_at: string;
          currency: string;
          environment: Database['platform']['Enums']['provider_environment'];
          id: string;
          market_id: string | null;
          metadata: NonNullable<Json>;
          name: string;
          owner_organization_id: string | null;
          provider_kind: Database['platform']['Enums']['provider_kind'];
          public_key: string | null;
          routing_priority: number;
          rsa_id_ref: string | null;
          rsa_public_key_ref: string | null;
          secret_hint: string | null;
          secret_key_ref: string | null;
          secret_set_at: string | null;
          secret_set_by: string | null;
          secret_vault_id: string | null;
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
          webhook_endpoint: string | null;
        };
        Insert: {
          api_base_url?: string | null;
          code: string;
          country_code: string;
          created_at?: string;
          currency: string;
          environment?: Database['platform']['Enums']['provider_environment'];
          id?: string;
          market_id?: string | null;
          metadata?: NonNullable<Json>;
          name: string;
          owner_organization_id?: string | null;
          provider_kind: Database['platform']['Enums']['provider_kind'];
          public_key?: string | null;
          routing_priority?: number;
          rsa_id_ref?: string | null;
          rsa_public_key_ref?: string | null;
          secret_hint?: string | null;
          secret_key_ref?: string | null;
          secret_set_at?: string | null;
          secret_set_by?: string | null;
          secret_vault_id?: string | null;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
          webhook_endpoint?: string | null;
        };
        Update: {
          api_base_url?: string | null;
          code?: string;
          country_code?: string;
          created_at?: string;
          currency?: string;
          environment?: Database['platform']['Enums']['provider_environment'];
          id?: string;
          market_id?: string | null;
          metadata?: NonNullable<Json>;
          name?: string;
          owner_organization_id?: string | null;
          provider_kind?: Database['platform']['Enums']['provider_kind'];
          public_key?: string | null;
          routing_priority?: number;
          rsa_id_ref?: string | null;
          rsa_public_key_ref?: string | null;
          secret_hint?: string | null;
          secret_key_ref?: string | null;
          secret_set_at?: string | null;
          secret_set_by?: string | null;
          secret_vault_id?: string | null;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
          webhook_endpoint?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_provider_accounts_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_market_id_fkey';
            columns: ['market_id'];
            isOneToOne: false;
            referencedRelation: 'markets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          created_at: string;
          currency: string;
          id: string;
          invoice_id: string;
          method: string | null;
          notes: string | null;
          paid_at: string | null;
          reference: string;
          status: Database['platform']['Enums']['payment_status'];
          updated_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          currency: string;
          id?: string;
          invoice_id: string;
          method?: string | null;
          notes?: string | null;
          paid_at?: string | null;
          reference: string;
          status?: Database['platform']['Enums']['payment_status'];
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          invoice_id?: string;
          method?: string | null;
          notes?: string | null;
          paid_at?: string | null;
          reference?: string;
          status?: Database['platform']['Enums']['payment_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'payments_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payments_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payments_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_revenue';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payments_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payments_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_discount_sign_legacy_invoices';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payments_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_invoice_balances';
            referencedColumns: ['invoice_id'];
          },
        ];
      };
      plan_prices: {
        Row: {
          amount: number;
          billing_interval: Database['platform']['Enums']['billing_interval'];
          charge_kind: Database['platform']['Enums']['charge_kind'];
          created_at: string;
          currency: string;
          id: string;
          market_id: string | null;
          plan_id: string;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          amount: number;
          billing_interval?: Database['platform']['Enums']['billing_interval'];
          charge_kind?: Database['platform']['Enums']['charge_kind'];
          created_at?: string;
          currency: string;
          id?: string;
          market_id?: string | null;
          plan_id: string;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          amount?: number;
          billing_interval?: Database['platform']['Enums']['billing_interval'];
          charge_kind?: Database['platform']['Enums']['charge_kind'];
          created_at?: string;
          currency?: string;
          id?: string;
          market_id?: string | null;
          plan_id?: string;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'plan_prices_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'plan_prices_market_id_fkey';
            columns: ['market_id'];
            isOneToOne: false;
            referencedRelation: 'markets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'plan_prices_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
        ];
      };
      plans: {
        Row: {
          code: string;
          created_at: string;
          deployment_mode: Database['platform']['Enums']['deployment_mode'] | null;
          description: string | null;
          id: string;
          included_companies: number;
          is_partner_base: boolean;
          metadata: NonNullable<Json>;
          multi_country: boolean;
          name: string;
          saas_product_id: string;
          sort_order: number;
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          deployment_mode?: Database['platform']['Enums']['deployment_mode'] | null;
          description?: string | null;
          id?: string;
          included_companies?: number;
          is_partner_base?: boolean;
          metadata?: NonNullable<Json>;
          multi_country?: boolean;
          name: string;
          saas_product_id: string;
          sort_order?: number;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          deployment_mode?: Database['platform']['Enums']['deployment_mode'] | null;
          description?: string | null;
          id?: string;
          included_companies?: number;
          is_partner_base?: boolean;
          metadata?: NonNullable<Json>;
          multi_country?: boolean;
          name?: string;
          saas_product_id?: string;
          sort_order?: number;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          granted_by: string | null;
          is_active: boolean;
          role: Database['platform']['Enums']['platform_role'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          granted_by?: string | null;
          is_active?: boolean;
          role: Database['platform']['Enums']['platform_role'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          granted_by?: string | null;
          is_active?: boolean;
          role?: Database['platform']['Enums']['platform_role'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_admins_granted_by_fkey';
            columns: ['granted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_admins_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_defaults: {
        Row: {
          config: NonNullable<Json>;
          id: number;
          updated_at: string;
        };
        Insert: {
          config?: NonNullable<Json>;
          id?: number;
          updated_at?: string;
        };
        Update: {
          config?: NonNullable<Json>;
          id?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_permissions: {
        Row: {
          code: string;
          created_at: string;
          description: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string;
        };
        Relationships: [];
      };
      product_capabilities: {
        Row: {
          code: string;
          combine_rule: string | null;
          created_at: string;
          description: string | null;
          id: string;
          introduced_in_contract: string | null;
          is_baseline: boolean;
          kind: string;
          manifest_version: string | null;
          meter_code: string | null;
          name: string;
          saas_product_id: string;
          scope_level: string;
          status: string;
          unit: string | null;
          updated_at: string;
        };
        Insert: {
          code: string;
          combine_rule?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          introduced_in_contract?: string | null;
          is_baseline?: boolean;
          kind: string;
          manifest_version?: string | null;
          meter_code?: string | null;
          name: string;
          saas_product_id: string;
          scope_level?: string;
          status?: string;
          unit?: string | null;
          updated_at?: string;
        };
        Update: {
          code?: string;
          combine_rule?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          introduced_in_contract?: string | null;
          is_baseline?: boolean;
          kind?: string;
          manifest_version?: string | null;
          meter_code?: string | null;
          name?: string;
          saas_product_id?: string;
          scope_level?: string;
          status?: string;
          unit?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_capabilities_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_capabilities_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'product_capabilities_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'product_capabilities_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      product_integrations: {
        Row: {
          adapter_key: Database['platform']['Enums']['integration_adapter'];
          additional_scopes: string[];
          algorithm: Database['platform']['Enums']['m2m_algorithm'] | null;
          allowed_hosts: string[];
          audience: string | null;
          code: string;
          contract_version: string;
          create_path_template: string | null;
          create_scope: string | null;
          created_at: string;
          cutover_state_billing: string;
          cutover_state_entitlements: string;
          enabled: boolean;
          entitlements_manifest_path: string | null;
          entitlements_path: string | null;
          entitlements_push_enabled: boolean;
          entitlements_read_scope: string | null;
          entitlements_write_scope: string | null;
          health_path_template: string | null;
          id: string;
          integration_type: Database['platform']['Enums']['integration_type'];
          issuer: string;
          metadata: NonNullable<Json>;
          name: string;
          owner_name: string | null;
          owner_user_id: string | null;
          provisioning_policy: Database['platform']['Enums']['provisioning_policy'];
          read_scope: string | null;
          saas_product_id: string;
          status: Database['platform']['Enums']['integration_status'];
          status_path_template: string | null;
          subject: string;
          token_ttl_seconds: number | null;
          updated_at: string;
          usage_ingest_enabled: boolean;
        };
        Insert: {
          adapter_key?: Database['platform']['Enums']['integration_adapter'];
          additional_scopes?: string[];
          algorithm?: Database['platform']['Enums']['m2m_algorithm'] | null;
          allowed_hosts?: string[];
          audience?: string | null;
          code: string;
          contract_version?: string;
          create_path_template?: string | null;
          create_scope?: string | null;
          created_at?: string;
          cutover_state_billing?: string;
          cutover_state_entitlements?: string;
          enabled?: boolean;
          entitlements_manifest_path?: string | null;
          entitlements_path?: string | null;
          entitlements_push_enabled?: boolean;
          entitlements_read_scope?: string | null;
          entitlements_write_scope?: string | null;
          health_path_template?: string | null;
          id?: string;
          integration_type: Database['platform']['Enums']['integration_type'];
          issuer?: string;
          metadata?: NonNullable<Json>;
          name: string;
          owner_name?: string | null;
          owner_user_id?: string | null;
          provisioning_policy?: Database['platform']['Enums']['provisioning_policy'];
          read_scope?: string | null;
          saas_product_id: string;
          status?: Database['platform']['Enums']['integration_status'];
          status_path_template?: string | null;
          subject?: string;
          token_ttl_seconds?: number | null;
          updated_at?: string;
          usage_ingest_enabled?: boolean;
        };
        Update: {
          adapter_key?: Database['platform']['Enums']['integration_adapter'];
          additional_scopes?: string[];
          algorithm?: Database['platform']['Enums']['m2m_algorithm'] | null;
          allowed_hosts?: string[];
          audience?: string | null;
          code?: string;
          contract_version?: string;
          create_path_template?: string | null;
          create_scope?: string | null;
          created_at?: string;
          cutover_state_billing?: string;
          cutover_state_entitlements?: string;
          enabled?: boolean;
          entitlements_manifest_path?: string | null;
          entitlements_path?: string | null;
          entitlements_push_enabled?: boolean;
          entitlements_read_scope?: string | null;
          entitlements_write_scope?: string | null;
          health_path_template?: string | null;
          id?: string;
          integration_type?: Database['platform']['Enums']['integration_type'];
          issuer?: string;
          metadata?: NonNullable<Json>;
          name?: string;
          owner_name?: string | null;
          owner_user_id?: string | null;
          provisioning_policy?: Database['platform']['Enums']['provisioning_policy'];
          read_scope?: string | null;
          saas_product_id?: string;
          status?: Database['platform']['Enums']['integration_status'];
          status_path_template?: string | null;
          subject?: string;
          token_ttl_seconds?: number | null;
          updated_at?: string;
          usage_ingest_enabled?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'product_integrations_owner_user_id_fkey';
            columns: ['owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_integrations_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_integrations_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'product_integrations_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'product_integrations_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      product_owners: {
        Row: {
          created_at: string;
          environment_scope: Database['platform']['Enums']['provisioning_environment'][] | null;
          granted_at: string;
          granted_by: string | null;
          id: string;
          is_active: boolean;
          role: Database['platform']['Enums']['product_owner_role'];
          saas_product_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          environment_scope?: Database['platform']['Enums']['provisioning_environment'][] | null;
          granted_at?: string;
          granted_by?: string | null;
          id?: string;
          is_active?: boolean;
          role?: Database['platform']['Enums']['product_owner_role'];
          saas_product_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          environment_scope?: Database['platform']['Enums']['provisioning_environment'][] | null;
          granted_at?: string;
          granted_by?: string | null;
          id?: string;
          is_active?: boolean;
          role?: Database['platform']['Enums']['product_owner_role'];
          saas_product_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_owners_granted_by_fkey';
            columns: ['granted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_owners_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_owners_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'product_owners_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'product_owners_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'product_owners_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          job_title: string | null;
          phone: string | null;
          settings: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          job_title?: string | null;
          phone?: string | null;
          settings?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          job_title?: string | null;
          phone?: string | null;
          settings?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [];
      };
      provider_customers: {
        Row: {
          created_at: string;
          external_customer_id: string;
          id: string;
          metadata: NonNullable<Json>;
          organization_id: string;
          provider_account_id: string;
          status: Database['platform']['Enums']['provider_mapping_status'];
          synced_at: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          external_customer_id: string;
          id?: string;
          metadata?: NonNullable<Json>;
          organization_id: string;
          provider_account_id: string;
          status?: Database['platform']['Enums']['provider_mapping_status'];
          synced_at?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          external_customer_id?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          organization_id?: string;
          provider_account_id?: string;
          status?: Database['platform']['Enums']['provider_mapping_status'];
          synced_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'provider_customers_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_customers_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'provider_customers_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'provider_customers_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'provider_customers_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'provider_customers_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'provider_customers_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_customers_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
        ];
      };
      provider_payment_methods: {
        Row: {
          brand: string | null;
          created_at: string;
          exp_month: number | null;
          exp_year: number | null;
          external_payment_method_id: string;
          id: string;
          is_default: boolean;
          last4: string | null;
          metadata: NonNullable<Json>;
          organization_id: string;
          provider_account_id: string;
          provider_customer_id: string | null;
          status: Database['platform']['Enums']['provider_mapping_status'];
          synced_at: string;
          updated_at: string;
        };
        Insert: {
          brand?: string | null;
          created_at?: string;
          exp_month?: number | null;
          exp_year?: number | null;
          external_payment_method_id: string;
          id?: string;
          is_default?: boolean;
          last4?: string | null;
          metadata?: NonNullable<Json>;
          organization_id: string;
          provider_account_id: string;
          provider_customer_id?: string | null;
          status?: Database['platform']['Enums']['provider_mapping_status'];
          synced_at?: string;
          updated_at?: string;
        };
        Update: {
          brand?: string | null;
          created_at?: string;
          exp_month?: number | null;
          exp_year?: number | null;
          external_payment_method_id?: string;
          id?: string;
          is_default?: boolean;
          last4?: string | null;
          metadata?: NonNullable<Json>;
          organization_id?: string;
          provider_account_id?: string;
          provider_customer_id?: string | null;
          status?: Database['platform']['Enums']['provider_mapping_status'];
          synced_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'provider_payment_methods_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_payment_methods_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'provider_payment_methods_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'provider_payment_methods_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'provider_payment_methods_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'provider_payment_methods_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'provider_payment_methods_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_payment_methods_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
          {
            foreignKeyName: 'provider_payment_methods_provider_customer_id_fkey';
            columns: ['provider_customer_id'];
            isOneToOne: false;
            referencedRelation: 'provider_customers';
            referencedColumns: ['id'];
          },
        ];
      };
      provider_plans: {
        Row: {
          amount: number;
          billing_interval: Database['platform']['Enums']['billing_interval'];
          created_at: string;
          currency: string;
          external_plan_id: string;
          id: string;
          metadata: NonNullable<Json>;
          plan_id: string;
          provider_account_id: string;
          status: Database['platform']['Enums']['provider_mapping_status'];
          synced_at: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          billing_interval: Database['platform']['Enums']['billing_interval'];
          created_at?: string;
          currency: string;
          external_plan_id: string;
          id?: string;
          metadata?: NonNullable<Json>;
          plan_id: string;
          provider_account_id: string;
          status?: Database['platform']['Enums']['provider_mapping_status'];
          synced_at?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          billing_interval?: Database['platform']['Enums']['billing_interval'];
          created_at?: string;
          currency?: string;
          external_plan_id?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          plan_id?: string;
          provider_account_id?: string;
          status?: Database['platform']['Enums']['provider_mapping_status'];
          synced_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'provider_plans_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'provider_plans_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_plans_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_plans_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
        ];
      };
      provider_subscriptions: {
        Row: {
          created_at: string;
          external_customer_id: string | null;
          external_payment_method_id: string | null;
          external_plan_id: string | null;
          external_subscription_id: string;
          id: string;
          last_error_code: string | null;
          last_error_message: string | null;
          metadata: NonNullable<Json>;
          next_billing_at: string | null;
          provider_account_id: string;
          provider_status: string;
          status: Database['platform']['Enums']['provider_mapping_status'];
          subscription_id: string;
          synced_at: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          external_customer_id?: string | null;
          external_payment_method_id?: string | null;
          external_plan_id?: string | null;
          external_subscription_id: string;
          id?: string;
          last_error_code?: string | null;
          last_error_message?: string | null;
          metadata?: NonNullable<Json>;
          next_billing_at?: string | null;
          provider_account_id: string;
          provider_status?: string;
          status?: Database['platform']['Enums']['provider_mapping_status'];
          subscription_id: string;
          synced_at?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          external_customer_id?: string | null;
          external_payment_method_id?: string | null;
          external_plan_id?: string | null;
          external_subscription_id?: string;
          id?: string;
          last_error_code?: string | null;
          last_error_message?: string | null;
          metadata?: NonNullable<Json>;
          next_billing_at?: string | null;
          provider_account_id?: string;
          provider_status?: string;
          status?: Database['platform']['Enums']['provider_mapping_status'];
          subscription_id?: string;
          synced_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'provider_subscriptions_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
        ];
      };
      provider_webhook_events: {
        Row: {
          error_code: string | null;
          error_message: string | null;
          event_type: string;
          external_event_key: string;
          id: string;
          payload: NonNullable<Json>;
          payment_id: string | null;
          processed_at: string | null;
          provider_account_id: string;
          received_at: string;
          status: Database['platform']['Enums']['webhook_event_status'];
          subscription_id: string | null;
        };
        Insert: {
          error_code?: string | null;
          error_message?: string | null;
          event_type: string;
          external_event_key: string;
          id?: string;
          payload?: NonNullable<Json>;
          payment_id?: string | null;
          processed_at?: string | null;
          provider_account_id: string;
          received_at?: string;
          status?: Database['platform']['Enums']['webhook_event_status'];
          subscription_id?: string | null;
        };
        Update: {
          error_code?: string | null;
          error_message?: string | null;
          event_type?: string;
          external_event_key?: string;
          id?: string;
          payload?: NonNullable<Json>;
          payment_id?: string | null;
          processed_at?: string | null;
          provider_account_id?: string;
          received_at?: string;
          status?: Database['platform']['Enums']['webhook_event_status'];
          subscription_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'provider_webhook_events_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_webhook_events_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['payment_id'];
          },
          {
            foreignKeyName: 'provider_webhook_events_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_webhook_events_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
          {
            foreignKeyName: 'provider_webhook_events_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_webhook_events_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_webhook_events_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_webhook_events_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_webhook_events_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_webhook_events_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_webhook_events_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
        ];
      };
      provisioning_events: {
        Row: {
          detail: NonNullable<Json>;
          id: string;
          message: string;
          occurred_at: string;
          provisioning_request_id: string;
          status: Database['platform']['Enums']['provisioning_status'];
        };
        Insert: {
          detail?: NonNullable<Json>;
          id?: string;
          message: string;
          occurred_at?: string;
          provisioning_request_id: string;
          status: Database['platform']['Enums']['provisioning_status'];
        };
        Update: {
          detail?: NonNullable<Json>;
          id?: string;
          message?: string;
          occurred_at?: string;
          provisioning_request_id?: string;
          status?: Database['platform']['Enums']['provisioning_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'provisioning_events_provisioning_request_id_fkey';
            columns: ['provisioning_request_id'];
            isOneToOne: false;
            referencedRelation: 'provisioning_requests';
            referencedColumns: ['id'];
          },
        ];
      };
      provisioning_requests: {
        Row: {
          action: Database['platform']['Enums']['provisioning_action'];
          attempts: number;
          created_at: string;
          deployment_target_id: string | null;
          error_message: string | null;
          finished_at: string | null;
          id: string;
          idempotency_key: string;
          max_attempts: number;
          mode: string;
          payload: NonNullable<Json>;
          requested_by: string | null;
          result: NonNullable<Json>;
          saas_product_id: string | null;
          started_at: string | null;
          status: Database['platform']['Enums']['provisioning_status'];
          tenant_id: string | null;
          updated_at: string;
        };
        Insert: {
          action: Database['platform']['Enums']['provisioning_action'];
          attempts?: number;
          created_at?: string;
          deployment_target_id?: string | null;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          idempotency_key: string;
          max_attempts?: number;
          mode?: string;
          payload?: NonNullable<Json>;
          requested_by?: string | null;
          result?: NonNullable<Json>;
          saas_product_id?: string | null;
          started_at?: string | null;
          status?: Database['platform']['Enums']['provisioning_status'];
          tenant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          action?: Database['platform']['Enums']['provisioning_action'];
          attempts?: number;
          created_at?: string;
          deployment_target_id?: string | null;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          idempotency_key?: string;
          max_attempts?: number;
          mode?: string;
          payload?: NonNullable<Json>;
          requested_by?: string | null;
          result?: NonNullable<Json>;
          saas_product_id?: string | null;
          started_at?: string | null;
          status?: Database['platform']['Enums']['provisioning_status'];
          tenant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'provisioning_requests_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'deployment_targets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provisioning_requests_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_provisioning_targets';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'provisioning_requests_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'provisioning_requests_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      provisioning_role_members: {
        Row: {
          created_at: string;
          granted_at: string;
          granted_by: string | null;
          id: string;
          is_active: boolean;
          notes: string | null;
          role: Database['platform']['Enums']['provisioning_role'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          granted_at?: string;
          granted_by?: string | null;
          id?: string;
          is_active?: boolean;
          notes?: string | null;
          role: Database['platform']['Enums']['provisioning_role'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          granted_at?: string;
          granted_by?: string | null;
          id?: string;
          is_active?: boolean;
          notes?: string | null;
          role?: Database['platform']['Enums']['provisioning_role'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'provisioning_role_members_granted_by_fkey';
            columns: ['granted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provisioning_role_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      provisioning_role_permissions: {
        Row: {
          permission_code: string;
          role: Database['platform']['Enums']['provisioning_role'];
        };
        Insert: {
          permission_code: string;
          role: Database['platform']['Enums']['provisioning_role'];
        };
        Update: {
          permission_code?: string;
          role?: Database['platform']['Enums']['provisioning_role'];
        };
        Relationships: [
          {
            foreignKeyName: 'provisioning_role_permissions_permission_code_fkey';
            columns: ['permission_code'];
            isOneToOne: false;
            referencedRelation: 'platform_permissions';
            referencedColumns: ['code'];
          },
        ];
      };
      saas_products: {
        Row: {
          accent_color: string | null;
          billing_unit: string;
          code: string;
          created_at: string;
          description: string | null;
          id: string;
          is_billable: boolean;
          lockup_name: string | null;
          metadata: NonNullable<Json>;
          name: string;
          short_name: string;
          sort_order: number;
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
        };
        Insert: {
          accent_color?: string | null;
          billing_unit?: string;
          code: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_billable?: boolean;
          lockup_name?: never;
          metadata?: NonNullable<Json>;
          name: string;
          short_name: string;
          sort_order?: number;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
        };
        Update: {
          accent_color?: string | null;
          billing_unit?: string;
          code?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_billable?: boolean;
          lockup_name?: never;
          metadata?: NonNullable<Json>;
          name?: string;
          short_name?: string;
          sort_order?: number;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      saas_provisioning_events: {
        Row: {
          action: string;
          actor_role: string | null;
          actor_user_id: string | null;
          attempt: number | null;
          correlation_id: string | null;
          detail: NonNullable<Json>;
          id: number;
          message: string;
          occurred_at: string;
          provider_http_status: number | null;
          saas_provisioning_request_id: string;
          status: Database['platform']['Enums']['saas_provisioning_status'];
        };
        Insert: {
          action: string;
          actor_role?: string | null;
          actor_user_id?: string | null;
          attempt?: number | null;
          correlation_id?: string | null;
          detail?: NonNullable<Json>;
          id?: never;
          message: string;
          occurred_at?: string;
          provider_http_status?: number | null;
          saas_provisioning_request_id: string;
          status: Database['platform']['Enums']['saas_provisioning_status'];
        };
        Update: {
          action?: string;
          actor_role?: string | null;
          actor_user_id?: string | null;
          attempt?: number | null;
          correlation_id?: string | null;
          detail?: NonNullable<Json>;
          id?: never;
          message?: string;
          occurred_at?: string;
          provider_http_status?: number | null;
          saas_provisioning_request_id?: string;
          status?: Database['platform']['Enums']['saas_provisioning_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'saas_provisioning_events_actor_user_id_fkey';
            columns: ['actor_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_events_saas_provisioning_request_id_fkey';
            columns: ['saas_provisioning_request_id'];
            isOneToOne: false;
            referencedRelation: 'saas_provisioning_requests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_events_saas_provisioning_request_id_fkey';
            columns: ['saas_provisioning_request_id'];
            isOneToOne: false;
            referencedRelation: 'v_saas_provisioning';
            referencedColumns: ['id'];
          },
        ];
      };
      saas_provisioning_requests: {
        Row: {
          attempt_count: number;
          cancel_reason: string | null;
          cancelled_at: string | null;
          completed_at: string | null;
          correlation_id: string;
          created_at: string;
          deployment_target_id: string | null;
          external_reference: string | null;
          id: string;
          idempotency_key: string;
          last_error_code: string | null;
          last_error_message: string | null;
          max_attempts: number;
          product_configuration: NonNullable<Json>;
          product_integration_id: string | null;
          provider_http_status: number | null;
          provisioning_environment: Database['platform']['Enums']['provisioning_environment'];
          provisioning_policy: Database['platform']['Enums']['provisioning_policy'];
          request_version: number;
          requested_at: string;
          requested_by: string | null;
          saas_product_id: string;
          started_at: string | null;
          status: Database['platform']['Enums']['saas_provisioning_status'];
          subscription_id: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          completed_at?: string | null;
          correlation_id?: string;
          created_at?: string;
          deployment_target_id?: string | null;
          external_reference?: string | null;
          id?: string;
          idempotency_key: string;
          last_error_code?: string | null;
          last_error_message?: string | null;
          max_attempts?: number;
          product_configuration?: NonNullable<Json>;
          product_integration_id?: string | null;
          provider_http_status?: number | null;
          provisioning_environment: Database['platform']['Enums']['provisioning_environment'];
          provisioning_policy?: Database['platform']['Enums']['provisioning_policy'];
          request_version?: number;
          requested_at?: string;
          requested_by?: string | null;
          saas_product_id: string;
          started_at?: string | null;
          status?: Database['platform']['Enums']['saas_provisioning_status'];
          subscription_id?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          completed_at?: string | null;
          correlation_id?: string;
          created_at?: string;
          deployment_target_id?: string | null;
          external_reference?: string | null;
          id?: string;
          idempotency_key?: string;
          last_error_code?: string | null;
          last_error_message?: string | null;
          max_attempts?: number;
          product_configuration?: NonNullable<Json>;
          product_integration_id?: string | null;
          provider_http_status?: number | null;
          provisioning_environment?: Database['platform']['Enums']['provisioning_environment'];
          provisioning_policy?: Database['platform']['Enums']['provisioning_policy'];
          request_version?: number;
          requested_at?: string;
          requested_by?: string | null;
          saas_product_id?: string;
          started_at?: string | null;
          status?: Database['platform']['Enums']['saas_provisioning_status'];
          subscription_id?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saas_provisioning_requests_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'deployment_targets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_provisioning_targets';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_product_integration_id_fkey';
            columns: ['product_integration_id'];
            isOneToOne: false;
            referencedRelation: 'product_integrations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      sales_agents: {
        Row: {
          agent_type: Database['platform']['Enums']['sales_agent_type'];
          code: string;
          contact_email: string | null;
          created_at: string;
          full_name: string;
          id: string;
          metadata: NonNullable<Json>;
          organization_id: string | null;
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
          user_id: string | null;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          agent_type?: Database['platform']['Enums']['sales_agent_type'];
          code: string;
          contact_email?: string | null;
          created_at?: string;
          full_name: string;
          id?: string;
          metadata?: NonNullable<Json>;
          organization_id?: string | null;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
          user_id?: string | null;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          agent_type?: Database['platform']['Enums']['sales_agent_type'];
          code?: string;
          contact_email?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          organization_id?: string | null;
          status?: Database['platform']['Enums']['entity_status'];
          updated_at?: string;
          user_id?: string | null;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sales_agents_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_agents_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'sales_agents_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'sales_agents_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'sales_agents_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'sales_agents_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'sales_agents_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      sales_attributions: {
        Row: {
          attribution_pct: number;
          channel_organization_id: string | null;
          commission_plan_id: string | null;
          created_at: string;
          customer_organization_id: string;
          id: string;
          notes: string | null;
          saas_product_id: string;
          sales_agent_id: string;
          source: Database['platform']['Enums']['attribution_source'];
          status: Database['platform']['Enums']['entity_status'];
          subscription_id: string | null;
          tenant_id: string | null;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          attribution_pct?: number;
          channel_organization_id?: string | null;
          commission_plan_id?: string | null;
          created_at?: string;
          customer_organization_id: string;
          id?: string;
          notes?: string | null;
          saas_product_id: string;
          sales_agent_id: string;
          source?: Database['platform']['Enums']['attribution_source'];
          status?: Database['platform']['Enums']['entity_status'];
          subscription_id?: string | null;
          tenant_id?: string | null;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          attribution_pct?: number;
          channel_organization_id?: string | null;
          commission_plan_id?: string | null;
          created_at?: string;
          customer_organization_id?: string;
          id?: string;
          notes?: string | null;
          saas_product_id?: string;
          sales_agent_id?: string;
          source?: Database['platform']['Enums']['attribution_source'];
          status?: Database['platform']['Enums']['entity_status'];
          subscription_id?: string | null;
          tenant_id?: string | null;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sales_attr_commission_plan_fk';
            columns: ['commission_plan_id'];
            isOneToOne: false;
            referencedRelation: 'commission_plans';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_attributions_channel_organization_id_fkey';
            columns: ['channel_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_attributions_channel_organization_id_fkey';
            columns: ['channel_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'sales_attributions_channel_organization_id_fkey';
            columns: ['channel_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'sales_attributions_channel_organization_id_fkey';
            columns: ['channel_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'sales_attributions_channel_organization_id_fkey';
            columns: ['channel_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'sales_attributions_channel_organization_id_fkey';
            columns: ['channel_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'sales_attributions_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_attributions_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'sales_attributions_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'sales_attributions_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'sales_attributions_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'sales_attributions_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'sales_attributions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_attributions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'sales_attributions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'sales_attributions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'sales_attributions_sales_agent_id_fkey';
            columns: ['sales_agent_id'];
            isOneToOne: false;
            referencedRelation: 'sales_agents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_attributions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_attributions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'sales_attributions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'sales_attributions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'sales_attributions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'sales_attributions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'sales_attributions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'sales_attributions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_attributions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'sales_attributions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'sales_attributions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      subscription_collection_profiles: {
        Row: {
          auto_charge: boolean;
          auto_suspend: boolean;
          collection_method: Database['platform']['Enums']['collection_method'];
          created_at: string;
          currency: string;
          document_lead_days: number;
          effective_from: string;
          effective_to: string | null;
          grace_period_days: number;
          id: string;
          invoice_lead_days: number;
          notes: string | null;
          payment_due_days: number;
          payment_method_id: string | null;
          provider_account_id: string | null;
          recurring_mode: string;
          renewal_notice_days: number;
          requires_purchase_order: boolean;
          requires_service_order: boolean;
          status: Database['platform']['Enums']['collection_profile_status'];
          subscription_id: string;
          updated_at: string;
        };
        Insert: {
          auto_charge?: boolean;
          auto_suspend?: boolean;
          collection_method: Database['platform']['Enums']['collection_method'];
          created_at?: string;
          currency: string;
          document_lead_days?: number;
          effective_from?: string;
          effective_to?: string | null;
          grace_period_days?: number;
          id?: string;
          invoice_lead_days?: number;
          notes?: string | null;
          payment_due_days?: number;
          payment_method_id?: string | null;
          provider_account_id?: string | null;
          recurring_mode?: string;
          renewal_notice_days?: number;
          requires_purchase_order?: boolean;
          requires_service_order?: boolean;
          status?: Database['platform']['Enums']['collection_profile_status'];
          subscription_id: string;
          updated_at?: string;
        };
        Update: {
          auto_charge?: boolean;
          auto_suspend?: boolean;
          collection_method?: Database['platform']['Enums']['collection_method'];
          created_at?: string;
          currency?: string;
          document_lead_days?: number;
          effective_from?: string;
          effective_to?: string | null;
          grace_period_days?: number;
          id?: string;
          invoice_lead_days?: number;
          notes?: string | null;
          payment_due_days?: number;
          payment_method_id?: string | null;
          provider_account_id?: string | null;
          recurring_mode?: string;
          renewal_notice_days?: number;
          requires_purchase_order?: boolean;
          requires_service_order?: boolean;
          status?: Database['platform']['Enums']['collection_profile_status'];
          subscription_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_collection_profiles_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_payment_method_id_fkey';
            columns: ['payment_method_id'];
            isOneToOne: false;
            referencedRelation: 'provider_payment_methods';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
        ];
      };
      subscription_commercial_documents: {
        Row: {
          amount: number | null;
          approved_at: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          document_number: string | null;
          document_type: Database['platform']['Enums']['commercial_document_type'];
          external_file_ref: string | null;
          id: string;
          notes: string | null;
          received_at: string | null;
          rejected_at: string | null;
          requested_at: string;
          status: Database['platform']['Enums']['commercial_document_status'];
          subscription_id: string;
          updated_at: string;
          updated_by: string | null;
          valid_from: string | null;
          valid_to: string | null;
        };
        Insert: {
          amount?: number | null;
          approved_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency: string;
          document_number?: string | null;
          document_type: Database['platform']['Enums']['commercial_document_type'];
          external_file_ref?: string | null;
          id?: string;
          notes?: string | null;
          received_at?: string | null;
          rejected_at?: string | null;
          requested_at?: string;
          status?: Database['platform']['Enums']['commercial_document_status'];
          subscription_id: string;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Update: {
          amount?: number | null;
          approved_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          document_number?: string | null;
          document_type?: Database['platform']['Enums']['commercial_document_type'];
          external_file_ref?: string | null;
          id?: string;
          notes?: string | null;
          received_at?: string | null;
          rejected_at?: string | null;
          requested_at?: string;
          status?: Database['platform']['Enums']['commercial_document_status'];
          subscription_id?: string;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_commercial_documents_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'subscription_commercial_documents_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscription_commercial_documents_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_commercial_documents_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_commercial_documents_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_commercial_documents_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_commercial_documents_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_commercial_documents_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
        ];
      };
      subscription_items: {
        Row: {
          ai_credit_entry_id: string | null;
          amount: number | null;
          billing_interval: Database['platform']['Enums']['billing_interval'];
          catalog_item_code: string | null;
          charge_kind: Database['platform']['Enums']['charge_kind'];
          corrects_line_id: string | null;
          created_at: string;
          currency: string;
          description: string;
          id: string;
          price_ref: string | null;
          quantity: number;
          source_type: string;
          subscription_id: string;
          tenant_addon_id: string | null;
          tenant_id: string | null;
          unit_amount: number;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          ai_credit_entry_id?: string | null;
          amount?: never;
          billing_interval?: Database['platform']['Enums']['billing_interval'];
          catalog_item_code?: string | null;
          charge_kind: Database['platform']['Enums']['charge_kind'];
          corrects_line_id?: string | null;
          created_at?: string;
          currency: string;
          description: string;
          id?: string;
          price_ref?: string | null;
          quantity?: number;
          source_type?: string;
          subscription_id: string;
          tenant_addon_id?: string | null;
          tenant_id?: string | null;
          unit_amount: number;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          ai_credit_entry_id?: string | null;
          amount?: never;
          billing_interval?: Database['platform']['Enums']['billing_interval'];
          catalog_item_code?: string | null;
          charge_kind?: Database['platform']['Enums']['charge_kind'];
          corrects_line_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string;
          id?: string;
          price_ref?: string | null;
          quantity?: number;
          source_type?: string;
          subscription_id?: string;
          tenant_addon_id?: string | null;
          tenant_id?: string | null;
          unit_amount?: number;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_items_catalog_item_code_fkey';
            columns: ['catalog_item_code'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'subscription_items_catalog_item_code_fkey';
            columns: ['catalog_item_code'];
            isOneToOne: false;
            referencedRelation: 'v_catalog_item_current_prices';
            referencedColumns: ['catalog_item_code'];
          },
          {
            foreignKeyName: 'subscription_items_corrects_line_id_fkey';
            columns: ['corrects_line_id'];
            isOneToOne: false;
            referencedRelation: 'invoice_lines';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscription_items_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'subscription_items_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscription_items_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_items_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_items_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_items_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_items_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_items_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscription_items_tenant_addon_fk';
            columns: ['tenant_addon_id'];
            isOneToOne: false;
            referencedRelation: 'tenant_addons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscription_items_tenant_addon_fk';
            columns: ['tenant_addon_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_addon_history';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscription_items_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscription_items_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscription_items_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscription_items_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      subscriptions: {
        Row: {
          billed_organization_id: string;
          billing_channel: string;
          billing_interval: Database['platform']['Enums']['billing_interval'];
          cancelled_at: string | null;
          channel_margin_rate: number | null;
          code: string;
          created_at: string;
          currency: string;
          ends_on: string | null;
          id: string;
          market_id: string | null;
          metadata: NonNullable<Json>;
          notes: string | null;
          plan_id: string;
          quantity: number;
          saas_product_id: string;
          started_on: string;
          status: Database['platform']['Enums']['subscription_status'];
          tenant_id: string | null;
          updated_at: string;
        };
        Insert: {
          billed_organization_id: string;
          billing_channel?: string;
          billing_interval?: Database['platform']['Enums']['billing_interval'];
          cancelled_at?: string | null;
          channel_margin_rate?: number | null;
          code: string;
          created_at?: string;
          currency: string;
          ends_on?: string | null;
          id?: string;
          market_id?: string | null;
          metadata?: NonNullable<Json>;
          notes?: string | null;
          plan_id: string;
          quantity?: number;
          saas_product_id: string;
          started_on?: string;
          status?: Database['platform']['Enums']['subscription_status'];
          tenant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          billed_organization_id?: string;
          billing_channel?: string;
          billing_interval?: Database['platform']['Enums']['billing_interval'];
          cancelled_at?: string | null;
          channel_margin_rate?: number | null;
          code?: string;
          created_at?: string;
          currency?: string;
          ends_on?: string | null;
          id?: string;
          market_id?: string | null;
          metadata?: NonNullable<Json>;
          notes?: string | null;
          plan_id?: string;
          quantity?: number;
          saas_product_id?: string;
          started_on?: string;
          status?: Database['platform']['Enums']['subscription_status'];
          tenant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'subscriptions_market_id_fkey';
            columns: ['market_id'];
            isOneToOne: false;
            referencedRelation: 'markets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      tenant_addons: {
        Row: {
          activated_at: string;
          active: boolean;
          addon_code: string;
          approved_at: string | null;
          approved_by: string | null;
          company_id: string | null;
          created_at: string;
          effective_from: string | null;
          effective_to: string | null;
          id: string;
          request_source: string;
          requested_at: string;
          requested_by: string | null;
          status: string;
          status_reason: string | null;
          subscription_item_id: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          activated_at?: string;
          active?: boolean;
          addon_code: string;
          approved_at?: string | null;
          approved_by?: string | null;
          company_id?: string | null;
          created_at?: string;
          effective_from?: string | null;
          effective_to?: string | null;
          id?: string;
          request_source?: string;
          requested_at?: string;
          requested_by?: string | null;
          status?: string;
          status_reason?: string | null;
          subscription_item_id?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          activated_at?: string;
          active?: boolean;
          addon_code?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          company_id?: string | null;
          created_at?: string;
          effective_from?: string | null;
          effective_to?: string | null;
          id?: string;
          request_source?: string;
          requested_at?: string;
          requested_by?: string | null;
          status?: string;
          status_reason?: string | null;
          subscription_item_id?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_addons_addon_code_fkey';
            columns: ['addon_code'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'tenant_addons_addon_code_fkey';
            columns: ['addon_code'];
            isOneToOne: false;
            referencedRelation: 'v_catalog_item_current_prices';
            referencedColumns: ['catalog_item_code'];
          },
          {
            foreignKeyName: 'tenant_addons_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_addons_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_addons_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'v_company_markets';
            referencedColumns: ['company_id'];
          },
          {
            foreignKeyName: 'tenant_addons_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_addons_subscription_item_id_fkey';
            columns: ['subscription_item_id'];
            isOneToOne: false;
            referencedRelation: 'subscription_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_addons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_addons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_addons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_addons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      tenant_deployments: {
        Row: {
          created_at: string;
          deployed_at: string | null;
          deployment_target_id: string;
          id: string;
          is_primary: boolean;
          notes: string | null;
          status: Database['platform']['Enums']['entity_status'];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deployed_at?: string | null;
          deployment_target_id: string;
          id?: string;
          is_primary?: boolean;
          notes?: string | null;
          status?: Database['platform']['Enums']['entity_status'];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deployed_at?: string | null;
          deployment_target_id?: string;
          id?: string;
          is_primary?: boolean;
          notes?: string | null;
          status?: Database['platform']['Enums']['entity_status'];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_deployments_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'deployment_targets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_deployments_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_provisioning_targets';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'tenant_deployments_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'tenant_deployments_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_deployments_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_deployments_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_deployments_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      tenant_entitlement_overrides: {
        Row: {
          approved_by: string;
          capability_id: string;
          created_at: string;
          expires_at: string;
          grant_value: NonNullable<Json>;
          id: string;
          override_type: string;
          reason: string;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          starts_at: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          approved_by: string;
          capability_id: string;
          created_at?: string;
          expires_at: string;
          grant_value?: NonNullable<Json>;
          id?: string;
          override_type: string;
          reason: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          starts_at?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          approved_by?: string;
          capability_id?: string;
          created_at?: string;
          expires_at?: string;
          grant_value?: NonNullable<Json>;
          id?: string;
          override_type?: string;
          reason?: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          starts_at?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_entitlement_overrides_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_entitlement_overrides_capability_id_fkey';
            columns: ['capability_id'];
            isOneToOne: false;
            referencedRelation: 'product_capabilities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_entitlement_overrides_revoked_by_fkey';
            columns: ['revoked_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_entitlement_overrides_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_entitlement_overrides_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_entitlement_overrides_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_entitlement_overrides_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      tenant_features: {
        Row: {
          created_at: string;
          enabled: boolean;
          feature_key: string;
          source: string;
          tenant_id: string;
          updated_at: string;
          updated_by: string | null;
          value: NonNullable<Json>;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          feature_key: string;
          source?: string;
          tenant_id: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: NonNullable<Json>;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          feature_key?: string;
          source?: string;
          tenant_id?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_features_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_features_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_features_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_features_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_features_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_memberships: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          role: Database['platform']['Enums']['tenant_role'];
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          role?: Database['platform']['Enums']['tenant_role'];
          tenant_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          role?: Database['platform']['Enums']['tenant_role'];
          tenant_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_memberships_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_memberships_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_memberships_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_memberships_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_memberships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_product_mappings: {
        Row: {
          created_at: string;
          deployment_target_id: string | null;
          external_company_id: string | null;
          external_organization_id: string | null;
          external_tenant_id: string | null;
          id: string;
          metadata: NonNullable<Json>;
          provisioned_at: string | null;
          registered_manually: boolean;
          saas_product_id: string;
          saas_provisioning_request_id: string | null;
          status: Database['platform']['Enums']['tenant_product_mapping_status'];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deployment_target_id?: string | null;
          external_company_id?: string | null;
          external_organization_id?: string | null;
          external_tenant_id?: string | null;
          id?: string;
          metadata?: NonNullable<Json>;
          provisioned_at?: string | null;
          registered_manually?: boolean;
          saas_product_id: string;
          saas_provisioning_request_id?: string | null;
          status?: Database['platform']['Enums']['tenant_product_mapping_status'];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deployment_target_id?: string | null;
          external_company_id?: string | null;
          external_organization_id?: string | null;
          external_tenant_id?: string | null;
          id?: string;
          metadata?: NonNullable<Json>;
          provisioned_at?: string | null;
          registered_manually?: boolean;
          saas_product_id?: string;
          saas_provisioning_request_id?: string | null;
          status?: Database['platform']['Enums']['tenant_product_mapping_status'];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_product_mappings_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'deployment_targets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_provisioning_targets';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_saas_provisioning_request_id_fkey';
            columns: ['saas_provisioning_request_id'];
            isOneToOne: false;
            referencedRelation: 'saas_provisioning_requests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_saas_provisioning_request_id_fkey';
            columns: ['saas_provisioning_request_id'];
            isOneToOne: false;
            referencedRelation: 'v_saas_provisioning';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_product_mappings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      tenant_settings: {
        Row: {
          config: NonNullable<Json>;
          created_at: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          config?: NonNullable<Json>;
          created_at?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          config?: NonNullable<Json>;
          created_at?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_settings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_settings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_settings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_settings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      tenants: {
        Row: {
          accent_color: string | null;
          activated_at: string | null;
          admin_activated_at: string | null;
          admin_email: string;
          churned_at: string | null;
          company_id: string | null;
          created_at: string;
          customer_organization_id: string;
          deployment_mode: Database['platform']['Enums']['deployment_mode'];
          environment: Database['platform']['Enums']['environment_kind'];
          id: string;
          logo_url: string | null;
          managing_organization_id: string | null;
          metadata: NonNullable<Json>;
          name: string;
          saas_product_id: string;
          slug: string;
          status: Database['platform']['Enums']['tenant_status'];
          tenant_type: Database['platform']['Enums']['tenant_type'];
          updated_at: string;
          white_label: boolean;
        };
        Insert: {
          accent_color?: string | null;
          activated_at?: string | null;
          admin_activated_at?: string | null;
          admin_email: string;
          churned_at?: string | null;
          company_id?: string | null;
          created_at?: string;
          customer_organization_id: string;
          deployment_mode?: Database['platform']['Enums']['deployment_mode'];
          environment?: Database['platform']['Enums']['environment_kind'];
          id?: string;
          logo_url?: string | null;
          managing_organization_id?: string | null;
          metadata?: NonNullable<Json>;
          name: string;
          saas_product_id: string;
          slug: string;
          status?: Database['platform']['Enums']['tenant_status'];
          tenant_type?: Database['platform']['Enums']['tenant_type'];
          updated_at?: string;
          white_label?: boolean;
        };
        Update: {
          accent_color?: string | null;
          activated_at?: string | null;
          admin_activated_at?: string | null;
          admin_email?: string;
          churned_at?: string | null;
          company_id?: string | null;
          created_at?: string;
          customer_organization_id?: string;
          deployment_mode?: Database['platform']['Enums']['deployment_mode'];
          environment?: Database['platform']['Enums']['environment_kind'];
          id?: string;
          logo_url?: string | null;
          managing_organization_id?: string | null;
          metadata?: NonNullable<Json>;
          name?: string;
          saas_product_id?: string;
          slug?: string;
          status?: Database['platform']['Enums']['tenant_status'];
          tenant_type?: Database['platform']['Enums']['tenant_type'];
          updated_at?: string;
          white_label?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'tenants_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenants_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'v_company_markets';
            referencedColumns: ['company_id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      usage_alert_acks: {
        Row: {
          acknowledged_at: string;
          acknowledged_by: string;
          alert_id: string;
          id: string;
          note: string | null;
        };
        Insert: {
          acknowledged_at?: string;
          acknowledged_by: string;
          alert_id: string;
          id?: string;
          note?: string | null;
        };
        Update: {
          acknowledged_at?: string;
          acknowledged_by?: string;
          alert_id?: string;
          id?: string;
          note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_alert_acks_acknowledged_by_fkey';
            columns: ['acknowledged_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alert_acks_alert_id_fkey';
            columns: ['alert_id'];
            isOneToOne: true;
            referencedRelation: 'usage_alerts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alert_acks_alert_id_fkey';
            columns: ['alert_id'];
            isOneToOne: true;
            referencedRelation: 'v_usage_alerts';
            referencedColumns: ['id'];
          },
        ];
      };
      usage_alerts: {
        Row: {
          aggregate_id: string | null;
          code: string;
          created_at: string;
          detail: NonNullable<Json>;
          id: string;
          saas_product_id: string | null;
          tenant_id: string | null;
        };
        Insert: {
          aggregate_id?: string | null;
          code: string;
          created_at?: string;
          detail?: NonNullable<Json>;
          id?: string;
          saas_product_id?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          aggregate_id?: string | null;
          code?: string;
          created_at?: string;
          detail?: NonNullable<Json>;
          id?: string;
          saas_product_id?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_alerts_aggregate_id_fkey';
            columns: ['aggregate_id'];
            isOneToOne: false;
            referencedRelation: 'usage_period_aggregates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alerts_aggregate_id_fkey';
            columns: ['aggregate_id'];
            isOneToOne: false;
            referencedRelation: 'v_usage_period_aggregates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alerts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alerts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_alerts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_alerts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_alerts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alerts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'usage_alerts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'usage_alerts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      usage_events: {
        Row: {
          capability_code: string | null;
          environment: Database['platform']['Enums']['provisioning_environment'];
          event_hash: string;
          event_id: string;
          external_company_id: string | null;
          id: string;
          ingest_batch_id: string;
          internal: Json | null;
          late: boolean;
          meter_code: string;
          meter_id: string;
          occurred_at: string;
          period_start: string;
          quantity: number;
          received_at: string;
          saas_product_id: string;
          subject_ref: string | null;
          tenant_id: string;
          unit: string;
        };
        Insert: {
          capability_code?: string | null;
          environment: Database['platform']['Enums']['provisioning_environment'];
          event_hash: string;
          event_id: string;
          external_company_id?: string | null;
          id?: string;
          ingest_batch_id: string;
          internal?: Json | null;
          late?: boolean;
          meter_code: string;
          meter_id: string;
          occurred_at: string;
          period_start: string;
          quantity: number;
          received_at?: string;
          saas_product_id: string;
          subject_ref?: string | null;
          tenant_id: string;
          unit: string;
        };
        Update: {
          capability_code?: string | null;
          environment?: Database['platform']['Enums']['provisioning_environment'];
          event_hash?: string;
          event_id?: string;
          external_company_id?: string | null;
          id?: string;
          ingest_batch_id?: string;
          internal?: Json | null;
          late?: boolean;
          meter_code?: string;
          meter_id?: string;
          occurred_at?: string;
          period_start?: string;
          quantity?: number;
          received_at?: string;
          saas_product_id?: string;
          subject_ref?: string | null;
          tenant_id?: string;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_events_meter_id_fkey';
            columns: ['meter_id'];
            isOneToOne: false;
            referencedRelation: 'usage_meters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'usage_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'usage_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      usage_ingest_credentials: {
        Row: {
          algorithm: Database['platform']['Enums']['m2m_algorithm'];
          audience: string;
          created_at: string;
          created_by: string | null;
          enabled: boolean;
          environment: Database['platform']['Enums']['provisioning_environment'];
          id: string;
          issuer: string;
          kid: string | null;
          public_key_ref: string;
          saas_product_id: string;
          updated_at: string;
        };
        Insert: {
          algorithm?: Database['platform']['Enums']['m2m_algorithm'];
          audience?: string;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          environment: Database['platform']['Enums']['provisioning_environment'];
          id?: string;
          issuer: string;
          kid?: string | null;
          public_key_ref: string;
          saas_product_id: string;
          updated_at?: string;
        };
        Update: {
          algorithm?: Database['platform']['Enums']['m2m_algorithm'];
          audience?: string;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          environment?: Database['platform']['Enums']['provisioning_environment'];
          id?: string;
          issuer?: string;
          kid?: string | null;
          public_key_ref?: string;
          saas_product_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_ingest_credentials_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_ingest_credentials_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_ingest_credentials_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_ingest_credentials_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_ingest_credentials_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      usage_ingest_rejections: {
        Row: {
          code: string;
          created_at: string;
          detail: NonNullable<Json>;
          environment: Database['platform']['Enums']['provisioning_environment'];
          event_id: string | null;
          id: string;
          ingest_batch_id: string;
          meter_code: string | null;
          saas_product_id: string;
          tenant_id: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          detail?: NonNullable<Json>;
          environment: Database['platform']['Enums']['provisioning_environment'];
          event_id?: string | null;
          id?: string;
          ingest_batch_id: string;
          meter_code?: string | null;
          saas_product_id: string;
          tenant_id?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          detail?: NonNullable<Json>;
          environment?: Database['platform']['Enums']['provisioning_environment'];
          event_id?: string | null;
          id?: string;
          ingest_batch_id?: string;
          meter_code?: string | null;
          saas_product_id?: string;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_ingest_rejections_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_ingest_rejections_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_ingest_rejections_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_ingest_rejections_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      usage_meters: {
        Row: {
          aggregation: string;
          allows_negative: boolean;
          billable_decided_by: string | null;
          billable_reason: string | null;
          capability_id: string | null;
          code: string;
          created_at: string;
          created_by: string | null;
          grace_hours: number;
          id: string;
          is_billable: boolean;
          measurement: string;
          name: string;
          saas_product_id: string;
          status: string;
          unit: string;
          updated_at: string;
        };
        Insert: {
          aggregation?: string;
          allows_negative?: boolean;
          billable_decided_by?: string | null;
          billable_reason?: string | null;
          capability_id?: string | null;
          code: string;
          created_at?: string;
          created_by?: string | null;
          grace_hours?: number;
          id?: string;
          is_billable?: boolean;
          measurement?: string;
          name: string;
          saas_product_id: string;
          status?: string;
          unit: string;
          updated_at?: string;
        };
        Update: {
          aggregation?: string;
          allows_negative?: boolean;
          billable_decided_by?: string | null;
          billable_reason?: string | null;
          capability_id?: string | null;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          grace_hours?: number;
          id?: string;
          is_billable?: boolean;
          measurement?: string;
          name?: string;
          saas_product_id?: string;
          status?: string;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_meters_billable_decided_by_fkey';
            columns: ['billable_decided_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_meters_capability_id_fkey';
            columns: ['capability_id'];
            isOneToOne: false;
            referencedRelation: 'product_capabilities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_meters_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_meters_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_meters_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_meters_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_meters_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      usage_period_aggregates: {
        Row: {
          allowance_included: number | null;
          allowance_status: string | null;
          closing_at: string | null;
          created_at: string;
          event_count: number;
          finalized_at: string | null;
          finalized_by: string | null;
          id: string;
          is_billable: boolean;
          late_event_count: number;
          meter_code: string;
          meter_id: string;
          overage_policy: string | null;
          overage_quantity: number | null;
          period_end: string;
          period_start: string;
          quantity: number;
          saas_product_id: string;
          source_hash: string | null;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          allowance_included?: number | null;
          allowance_status?: string | null;
          closing_at?: string | null;
          created_at?: string;
          event_count?: number;
          finalized_at?: string | null;
          finalized_by?: string | null;
          id?: string;
          is_billable?: boolean;
          late_event_count?: number;
          meter_code: string;
          meter_id: string;
          overage_policy?: string | null;
          overage_quantity?: number | null;
          period_end: string;
          period_start: string;
          quantity?: number;
          saas_product_id: string;
          source_hash?: string | null;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          allowance_included?: number | null;
          allowance_status?: string | null;
          closing_at?: string | null;
          created_at?: string;
          event_count?: number;
          finalized_at?: string | null;
          finalized_by?: string | null;
          id?: string;
          is_billable?: boolean;
          late_event_count?: number;
          meter_code?: string;
          meter_id?: string;
          overage_policy?: string | null;
          overage_quantity?: number | null;
          period_end?: string;
          period_start?: string;
          quantity?: number;
          saas_product_id?: string;
          source_hash?: string | null;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_period_aggregates_finalized_by_fkey';
            columns: ['finalized_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_meter_id_fkey';
            columns: ['meter_id'];
            isOneToOne: false;
            referencedRelation: 'usage_meters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      user_invitations: {
        Row: {
          accepted_at: string | null;
          access_grant: NonNullable<Json>;
          created_at: string;
          delivery: string;
          email: string;
          full_name: string | null;
          id: string;
          invited_by: string | null;
          revoked_at: string | null;
          status: string;
          user_id: string | null;
        };
        Insert: {
          accepted_at?: string | null;
          access_grant?: NonNullable<Json>;
          created_at?: string;
          delivery: string;
          email: string;
          full_name?: string | null;
          id?: string;
          invited_by?: string | null;
          revoked_at?: string | null;
          status?: string;
          user_id?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          access_grant?: NonNullable<Json>;
          created_at?: string;
          delivery?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          invited_by?: string | null;
          revoked_at?: string | null;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'user_invitations_invited_by_fkey';
            columns: ['invited_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_invitations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      workspace_apps: {
        Row: {
          activated_at: string | null;
          created_at: string;
          organization_id: string;
          saas_product_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          activated_at?: string | null;
          created_at?: string;
          organization_id: string;
          saas_product_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          activated_at?: string | null;
          created_at?: string;
          organization_id?: string;
          saas_product_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'workspace_apps_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'workspace_apps_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'workspace_apps_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'workspace_apps_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'workspace_apps_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'workspace_apps_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'workspace_apps_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'workspace_apps_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'workspace_apps_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'workspace_apps_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
    };
    Views: {
      v_ai_credit_balances: {
        Row: {
          adjusted: number | null;
          balance: number | null;
          bonus: number | null;
          expired: number | null;
          included: number | null;
          period_start: string | null;
          pool_key: string | null;
          purchased: number | null;
          reserved: number | null;
          rollover_net: number | null;
          saas_product_id: string | null;
          tenant_id: string | null;
          used: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_credit_ledger_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'ai_credit_ledger_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      v_billing_contact_readiness: {
        Row: {
          billing_address: string | null;
          billing_city: string | null;
          billing_email: string | null;
          billing_first_name: string | null;
          billing_last_name: string | null;
          billing_phone: string | null;
          country_code: string | null;
          missing_fields: string[] | null;
          organization_id: string | null;
          organization_name: string | null;
          ready_for_card_payment: boolean | null;
        };
        Insert: {
          billing_address?: string | null;
          billing_city?: string | null;
          billing_email?: string | null;
          billing_first_name?: string | null;
          billing_last_name?: string | null;
          billing_phone?: string | null;
          country_code?: string | null;
          missing_fields?: never;
          organization_id?: string | null;
          organization_name?: string | null;
          ready_for_card_payment?: never;
        };
        Update: {
          billing_address?: string | null;
          billing_city?: string | null;
          billing_email?: string | null;
          billing_first_name?: string | null;
          billing_last_name?: string | null;
          billing_phone?: string | null;
          country_code?: string | null;
          missing_fields?: never;
          organization_id?: string | null;
          organization_name?: string | null;
          ready_for_card_payment?: never;
        };
        Relationships: [];
      };
      v_card_on_file_authorizations: {
        Row: {
          accepted_at: string | null;
          brand: string | null;
          external_payment_method_id: string | null;
          id: string | null;
          is_active: boolean | null;
          last4: string | null;
          link_id: string | null;
          organization_id: string | null;
          organization_name: string | null;
          payment_method_id: string | null;
          payment_method_status: Database['platform']['Enums']['provider_mapping_status'] | null;
          provider_account_code: string | null;
          provider_account_id: string | null;
          provider_environment: Database['platform']['Enums']['provider_environment'] | null;
          revoke_reason: string | null;
          revoke_source: string | null;
          revoked_at: string | null;
          subscriptions_on_card: number | null;
          terms_version: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'card_on_file_authorizations_link_id_fkey';
            columns: ['link_id'];
            isOneToOne: false;
            referencedRelation: 'payment_links';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_link_id_fkey';
            columns: ['link_id'];
            isOneToOne: false;
            referencedRelation: 'v_payment_links';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_payment_method_id_fkey';
            columns: ['payment_method_id'];
            isOneToOne: false;
            referencedRelation: 'provider_payment_methods';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'card_on_file_authorizations_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
        ];
      };
      v_catalog_item_current_prices: {
        Row: {
          amount: number | null;
          billing_interval: Database['platform']['Enums']['billing_interval'] | null;
          billing_model: string | null;
          catalog_item_code: string | null;
          catalog_item_id: string | null;
          catalog_item_name: string | null;
          charge_kind: Database['platform']['Enums']['charge_kind'] | null;
          currency: string | null;
          is_current: boolean | null;
          is_scheduled: boolean | null;
          lifecycle_status: string | null;
          market_code: string | null;
          market_id: string | null;
          market_name: string | null;
          price_id: string | null;
          saas_product_id: string | null;
          valid_from: string | null;
          valid_to: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'catalog_item_prices_catalog_item_id_fkey';
            columns: ['catalog_item_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'catalog_item_prices_currency_fkey';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'catalog_item_prices_market_id_fkey';
            columns: ['market_id'];
            isOneToOne: false;
            referencedRelation: 'markets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'catalog_items_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'catalog_items_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'catalog_items_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'catalog_items_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      v_collected_payments: {
        Row: {
          collected_amount: number | null;
          collected_month: string | null;
          collected_on: string | null;
          currency: string | null;
          customer_organization_id: string | null;
          invoice_id: string | null;
          invoice_number: string | null;
          method: string | null;
          organization_name: string | null;
          payment_amount: number | null;
          payment_id: string | null;
          reference: string | null;
          subscription_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
        ];
      };
      v_collected_revenue: {
        Row: {
          charge_kind: Database['platform']['Enums']['charge_kind'] | null;
          collected_amount: number | null;
          collected_on: string | null;
          currency: string | null;
          customer_organization_id: string | null;
          invoice_id: string | null;
          is_recurring: boolean | null;
          period_end: string | null;
          period_start: string | null;
          saas_product_id: string | null;
          tenant_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'invoice_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'invoice_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'invoice_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'invoice_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'invoice_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'invoices_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      v_commercial_audit_log: {
        Row: {
          action: string | null;
          actor_email: string | null;
          actor_user_id: string | null;
          entity_id: string | null;
          entity_type: string | null;
          id: number | null;
          metadata: Json | null;
          occurred_at: string | null;
          organization_id: string | null;
          tenant_id: string | null;
        };
        Insert: {
          action?: string | null;
          actor_email?: string | null;
          actor_user_id?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: number | null;
          metadata?: Json | null;
          occurred_at?: string | null;
          organization_id?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          action?: string | null;
          actor_email?: string | null;
          actor_user_id?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: number | null;
          metadata?: Json | null;
          occurred_at?: string | null;
          organization_id?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_actor_user_id_fkey';
            columns: ['actor_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'audit_logs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_logs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'audit_logs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'audit_logs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      v_commercial_cutover_axes: {
        Row: {
          cutover_state_billing: string | null;
          cutover_state_entitlements: string | null;
          integration_code: string | null;
          integration_id: string | null;
          integration_name: string | null;
          product_code: string | null;
          product_short_name: string | null;
          saas_product_id: string | null;
          updated_at: string | null;
          usage_ingest_enabled: boolean | null;
        };
        Relationships: [];
      };
      v_commercial_cutover_history: {
        Row: {
          actor_name: string | null;
          actor_user_id: string | null;
          axis: string | null;
          from_state: string | null;
          id: number | null;
          integration_code: string | null;
          integration_id: string | null;
          occurred_at: string | null;
          product_code: string | null;
          reason: string | null;
          saas_product_id: string | null;
          to_state: string | null;
        };
        Relationships: [];
      };
      v_commission_detail: {
        Row: {
          agent_code: string | null;
          agent_name: string | null;
          amount: number | null;
          applied_rate: number | null;
          attribution_pct: number | null;
          base_amount: number | null;
          charge_kind: Database['platform']['Enums']['charge_kind'] | null;
          commission_event_id: string | null;
          currency: string | null;
          earned_on: string | null;
          has_reversal: boolean | null;
          invoice_id: string | null;
          invoice_number: string | null;
          is_reversal: boolean | null;
          paid_at: string | null;
          payment_id: string | null;
          payment_method: string | null;
          payment_reference: string | null;
          payment_status: Database['platform']['Enums']['payment_status'] | null;
          product_short_name: string | null;
          reversal_of_event_id: string | null;
          reversal_reason: string | null;
          rule_basis: Database['platform']['Enums']['commission_basis'] | null;
          rule_name: string | null;
          saas_product_id: string | null;
          sales_agent_id: string | null;
          settlement_code: string | null;
          settlement_id: string | null;
          settlement_status: Database['platform']['Enums']['settlement_status'] | null;
          source_label: string | null;
          status: Database['platform']['Enums']['commission_status'] | null;
          tenant_id: string | null;
          tenant_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'commission_events_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'commission_events_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['payment_id'];
          },
          {
            foreignKeyName: 'commission_events_reversal_of_event_id_fkey';
            columns: ['reversal_of_event_id'];
            isOneToOne: false;
            referencedRelation: 'commission_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_reversal_of_event_id_fkey';
            columns: ['reversal_of_event_id'];
            isOneToOne: false;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['commission_event_id'];
          },
          {
            foreignKeyName: 'commission_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'commission_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'commission_events_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'commission_events_sales_agent_id_fkey';
            columns: ['sales_agent_id'];
            isOneToOne: false;
            referencedRelation: 'sales_agents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_settlement_id_fkey';
            columns: ['settlement_id'];
            isOneToOne: false;
            referencedRelation: 'commission_settlements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commission_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'commission_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'commission_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      v_company_markets: {
        Row: {
          company_id: string | null;
          country_code: string | null;
          currency: string | null;
          in_regional_model: boolean | null;
          is_default: boolean | null;
          market_code: string | null;
          market_default_currency: string | null;
          market_id: string | null;
          market_name: string | null;
          name: string | null;
          organization_id: string | null;
          organization_kind: Database['platform']['Enums']['org_kind'] | null;
          organization_name: string | null;
          status: Database['platform']['Enums']['entity_status'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'companies_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'companies_market_id_fkey';
            columns: ['market_id'];
            isOneToOne: false;
            referencedRelation: 'markets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'markets_default_currency_code_fkey';
            columns: ['market_default_currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
        ];
      };
      v_cost_entry_list: {
        Row: {
          allocated_amount: number | null;
          allocation_count: number | null;
          allocations: Json | null;
          amount: number | null;
          category: Database['platform']['Enums']['cost_category'] | null;
          category_text: string | null;
          currency: string | null;
          description: string | null;
          id: string | null;
          is_recurring: boolean | null;
          period_end: string | null;
          period_start: string | null;
          platform_amount: number | null;
          scopes: string[] | null;
          unallocated_amount: number | null;
          vendor: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'cost_entries_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
        ];
      };
      v_currency_integrity_issues: {
        Row: {
          issue_kind: string | null;
          parent_currency: string | null;
          parent_id: string | null;
          parent_kind: string | null;
          record_currency: string | null;
          record_id: string | null;
        };
        Relationships: [];
      };
      v_discount_sign_legacy_invoices: {
        Row: {
          currency: string | null;
          customer_organization_id: string | null;
          invoice_id: string | null;
          issue_date: string | null;
          legacy_total: number | null;
          number: string | null;
          signed_total: number | null;
          status: Database['platform']['Enums']['invoice_status'] | null;
          subscription_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
        ];
      };
      v_entitlement_sync_status: {
        Row: {
          applied_checksum: string | null;
          applied_status: string | null;
          applied_version: number | null;
          cohort_state: string | null;
          consecutive_failures: number | null;
          cutover_state_entitlements: string | null;
          desired_checksum: string | null;
          desired_dirty: boolean | null;
          desired_version: number | null;
          integration_code: string | null;
          last_push_at: string | null;
          last_push_result: string | null;
          last_pushed_version: number | null;
          last_verified_at: string | null;
          next_attempt_at: string | null;
          product_code: string | null;
          product_name: string | null;
          push_enabled: boolean | null;
          saas_product_id: string | null;
          state: string | null;
          state_changed_at: string | null;
          state_reason: string | null;
          tenant_id: string | null;
          tenant_name: string | null;
          tenant_slug: string | null;
          unknown_capabilities: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'entitlement_sync_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'entitlement_sync_state_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      v_finance_facts: {
        Row: {
          amount: number | null;
          currency: string | null;
          detail: string | null;
          fact_date: string | null;
          market_id: string | null;
          metric: string | null;
          organization_id: string | null;
          partner_organization_id: string | null;
          saas_product_id: string | null;
        };
        Relationships: [];
      };
      v_finance_reconciliation: {
        Row: {
          amount: number | null;
          currency: string | null;
          detail: string | null;
          finding_type: string | null;
          organization_name: string | null;
          severity: string | null;
          subject: string | null;
          subscription_id: string | null;
        };
        Relationships: [];
      };
      v_invoice_balances: {
        Row: {
          aging_bucket: string | null;
          balance: number | null;
          confirmed_paid: number | null;
          confirmed_payments: number | null;
          currency: string | null;
          customer_organization_id: string | null;
          days_overdue: number | null;
          due_date: string | null;
          invoice_id: string | null;
          is_receivable: boolean | null;
          issue_date: string | null;
          number: string | null;
          organization_name: string | null;
          period_end: string | null;
          period_start: string | null;
          reversed_amount: number | null;
          status: Database['platform']['Enums']['invoice_status'] | null;
          subscription_id: string | null;
          total: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
        ];
      };
      v_partner_agreements: {
        Row: {
          agreement_id: string | null;
          allowed_deployment_modes: Database['platform']['Enums']['deployment_mode'][] | null;
          allowed_tenant_types: Database['platform']['Enums']['tenant_type'][] | null;
          billing_responsibility: Database['platform']['Enums']['billing_responsibility'] | null;
          can_manage_tenants: boolean | null;
          can_resell: boolean | null;
          channel_mrr: number | null;
          channel_mrr_by_currency: Json | null;
          default_deployment_mode: Database['platform']['Enums']['deployment_mode'] | null;
          managed_tenants: number | null;
          margin_rate: number | null;
          max_tenants: number | null;
          notes: string | null;
          organization_id: string | null;
          organization_name: string | null;
          organization_slug: string | null;
          product_code: string | null;
          product_short_name: string | null;
          saas_product_id: string | null;
          shared_tenants: number | null;
          status: Database['platform']['Enums']['entity_status'] | null;
          valid_from: string | null;
          valid_to: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'organization_product_agreements_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      v_partner_fee_statement_lines: {
        Row: {
          agreement_id: string | null;
          base_list_amount: number | null;
          basis: Json | null;
          created_at: string | null;
          currency: string | null;
          fee_amount: number | null;
          fee_fixed_amount: number | null;
          fee_rate: number | null;
          id: string | null;
          line_kind: string | null;
          product_code: string | null;
          product_short_name: string | null;
          saas_product_id: string | null;
          statement_id: string | null;
          subscription_code: string | null;
          subscription_id: string | null;
          tenant_id: string | null;
          tenant_name: string | null;
          tenant_slug: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'partner_fee_statement_lines_agreement_id_fkey';
            columns: ['agreement_id'];
            isOneToOne: false;
            referencedRelation: 'organization_product_agreements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_agreement_id_fkey';
            columns: ['agreement_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_agreements';
            referencedColumns: ['agreement_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_currency_fkey';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_statement_id_fkey';
            columns: ['statement_id'];
            isOneToOne: false;
            referencedRelation: 'partner_fee_statements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_statement_id_fkey';
            columns: ['statement_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_fee_statements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'partner_fee_statement_lines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      v_partner_fee_statements: {
        Row: {
          base_total: number | null;
          computed_at: string | null;
          computed_by: string | null;
          created_at: string | null;
          currency: string | null;
          fee_total: number | null;
          id: string | null;
          invoice_balance: number | null;
          invoice_due_date: string | null;
          invoice_id: string | null;
          invoice_number: string | null;
          invoice_status: Database['platform']['Enums']['invoice_status'] | null;
          invoice_total: number | null;
          issued_at: string | null;
          issued_by: string | null;
          line_count: number | null;
          partner_name: string | null;
          partner_organization_id: string | null;
          partner_slug: string | null;
          period_end: string | null;
          period_start: string | null;
          source_hash: string | null;
          status: string | null;
          tenant_count: number | null;
          updated_at: string | null;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'partner_fee_statements_computed_by_fkey';
            columns: ['computed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_currency_fkey';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_revenue';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_discount_sign_legacy_invoices';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_invoice_balances';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_issued_by_fkey';
            columns: ['issued_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_partner_organization_id_fkey';
            columns: ['partner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'partner_fee_statements_voided_by_fkey';
            columns: ['voided_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      v_partner_finance: {
        Row: {
          active_agreements: number | null;
          agent_commissions: number | null;
          collected_revenue: number | null;
          currency: string | null;
          direct_cost: number | null;
          gross_margin: number | null;
          managed_tenants: number | null;
          mrr: number | null;
          organization_id: string | null;
          organization_name: string | null;
          organization_slug: string | null;
          weighted_channel_margin_rate: number | null;
        };
        Relationships: [];
      };
      v_partner_margin: {
        Row: {
          collected_revenue: number | null;
          commission_total: number | null;
          currency: string | null;
          direct_cost: number | null;
          display_name: string | null;
          gross_margin: number | null;
          managed_tenants: number | null;
          mrr: number | null;
          organization_id: string | null;
        };
        Relationships: [];
      };
      v_payment_charge_attempts: {
        Row: {
          amount: number | null;
          attempt_no: number | null;
          brand: string | null;
          completed_at: string | null;
          created_at: string | null;
          created_by: string | null;
          currency: string | null;
          error_code: string | null;
          external_charge_id: string | null;
          id: string | null;
          invoice_id: string | null;
          invoice_number: string | null;
          last4: string | null;
          next_retry_at: string | null;
          organization_id: string | null;
          payment_id: string | null;
          status: string | null;
          subscription_id: string | null;
          trigger_source: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'invoices_customer_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'invoices_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_currency_fkey';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_revenue';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_commission_detail';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_discount_sign_legacy_invoices';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'v_invoice_balances';
            referencedColumns: ['invoice_id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_charge_attempts_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'v_collected_payments';
            referencedColumns: ['payment_id'];
          },
        ];
      };
      v_payment_links: {
        Row: {
          access_count: number | null;
          allow_card_enrollment: boolean | null;
          charges_failed: number | null;
          charges_ok: number | null;
          created_at: string | null;
          created_by: string | null;
          expires_at: string | null;
          id: string | null;
          last_accessed_at: string | null;
          last_event_at: string | null;
          organization_id: string | null;
          organization_name: string | null;
          rate_limited: number | null;
          revoke_reason: string | null;
          revoked_at: string | null;
          status: string | null;
          token_hint: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'payment_links_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      v_plan_price_catalog: {
        Row: {
          amount: number | null;
          billing_interval: Database['platform']['Enums']['billing_interval'] | null;
          charge_kind: Database['platform']['Enums']['charge_kind'] | null;
          currency: string | null;
          deployment_mode: Database['platform']['Enums']['deployment_mode'] | null;
          is_current: boolean | null;
          is_legacy: boolean | null;
          is_scheduled: boolean | null;
          market_code: string | null;
          market_id: string | null;
          market_name: string | null;
          plan_code: string | null;
          plan_id: string | null;
          plan_name: string | null;
          price_id: string | null;
          saas_product_id: string | null;
          valid_from: string | null;
          valid_to: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'plan_prices_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'plan_prices_market_id_fkey';
            columns: ['market_id'];
            isOneToOne: false;
            referencedRelation: 'markets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'plan_prices_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'plans_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      v_product_finance: {
        Row: {
          active_subscriptions: number | null;
          active_tenants: number | null;
          arr: number | null;
          collected_implementation: number | null;
          collected_infrastructure: number | null;
          collected_license: number | null;
          collected_one_time: number | null;
          collected_recurring: number | null;
          collected_revenue: number | null;
          collected_support: number | null;
          commission_paid: number | null;
          commission_pending: number | null;
          commission_total: number | null;
          currency: string | null;
          direct_cost: number | null;
          gross_margin: number | null;
          margin_rate: number | null;
          mrr: number | null;
          product_code: string | null;
          saas_product_id: string | null;
          short_name: string | null;
        };
        Relationships: [];
      };
      v_product_margin: {
        Row: {
          arr: number | null;
          collected_one_time: number | null;
          collected_recurring: number | null;
          collected_revenue: number | null;
          commission_paid: number | null;
          commission_pending: number | null;
          commission_total: number | null;
          currency: string | null;
          direct_cost: number | null;
          gross_margin: number | null;
          mrr: number | null;
          product_code: string | null;
          saas_product_id: string | null;
          short_name: string | null;
        };
        Relationships: [];
      };
      v_provider_account_routes: {
        Row: {
          code: string | null;
          country_code: string | null;
          currencies: string[] | null;
          environment: Database['platform']['Enums']['provider_environment'] | null;
          is_live: boolean | null;
          market_code: string | null;
          market_id: string | null;
          market_name: string | null;
          name: string | null;
          owner_organization_id: string | null;
          primary_currency: string | null;
          provider_account_id: string | null;
          provider_kind: Database['platform']['Enums']['provider_kind'] | null;
          routing_priority: number | null;
          status: Database['platform']['Enums']['entity_status'] | null;
          supported_methods: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_provider_accounts_currency_fk';
            columns: ['primary_currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_market_id_fkey';
            columns: ['market_id'];
            isOneToOne: false;
            referencedRelation: 'markets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'payment_provider_accounts_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      v_provider_reconciliation: {
        Row: {
          billed_organization_id: string | null;
          billed_organization_name: string | null;
          confirmed_payments: number | null;
          external_subscription_id: string | null;
          last_error_code: string | null;
          last_error_message: string | null;
          local_status: Database['platform']['Enums']['subscription_status'] | null;
          next_billing_at: string | null;
          provider_account_code: string | null;
          provider_account_id: string | null;
          provider_environment: Database['platform']['Enums']['provider_environment'] | null;
          provider_status: string | null;
          provider_subscription_id: string | null;
          reconciliation_status: string | null;
          rejected_events: number | null;
          subscription_code: string | null;
          subscription_id: string | null;
          synced_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'provider_subscriptions_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'provider_subscriptions_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      v_provisioning_targets: {
        Row: {
          algorithm: Database['platform']['Enums']['m2m_algorithm'] | null;
          audience: string | null;
          base_url: string | null;
          code: string | null;
          contract_version: string | null;
          create_path_template: string | null;
          create_scope: string | null;
          credential_profile_code: string | null;
          credential_profile_enabled: boolean | null;
          credential_profile_id: string | null;
          credential_profile_type: Database['platform']['Enums']['credential_profile_type'] | null;
          credential_secret_configured: boolean | null;
          deployment_mode: Database['platform']['Enums']['deployment_mode'] | null;
          deployment_target_id: string | null;
          effective_provisioning_policy:
            Database['platform']['Enums']['provisioning_policy'] | null;
          health_checked_at: string | null;
          health_detail: string | null;
          health_path_template: string | null;
          health_status: Database['platform']['Enums']['deployment_health'] | null;
          integration_code: string | null;
          integration_enabled: boolean | null;
          integration_status: Database['platform']['Enums']['integration_status'] | null;
          integration_type: Database['platform']['Enums']['integration_type'] | null;
          issuer: string | null;
          name: string | null;
          owner_organization_id: string | null;
          owner_organization_name: string | null;
          product_code: string | null;
          product_integration_id: string | null;
          product_short_name: string | null;
          provisioning_enabled: boolean | null;
          provisioning_environment:
            Database['platform']['Enums']['provisioning_environment'] | null;
          provisioning_status: Database['platform']['Enums']['deployment_target_status'] | null;
          read_scope: string | null;
          retry_count: number | null;
          saas_product_id: string | null;
          status_path_template: string | null;
          subject: string | null;
          timeout_ms: number | null;
          token_ttl_seconds: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'deployment_targets_credential_profile_id_fkey';
            columns: ['credential_profile_id'];
            isOneToOne: false;
            referencedRelation: 'credential_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'deployment_targets_owner_organization_id_fkey';
            columns: ['owner_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'deployment_targets_product_integration_id_fkey';
            columns: ['product_integration_id'];
            isOneToOne: false;
            referencedRelation: 'product_integrations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deployment_targets_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deployment_targets_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'deployment_targets_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'deployment_targets_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      v_renewal_dashboard: {
        Row: {
          auto_suspend: boolean | null;
          billed_organization_id: string | null;
          billed_organization_name: string | null;
          billing_interval: Database['platform']['Enums']['billing_interval'] | null;
          collection_method: Database['platform']['Enums']['collection_method'] | null;
          critical_alerts: number | null;
          currency: string | null;
          days_to_renewal: number | null;
          grace_period_days: number | null;
          in_grace: boolean | null;
          is_past_due: boolean | null;
          open_alerts: number | null;
          product_code: string | null;
          product_short_name: string | null;
          provider_account_code: string | null;
          renewal_on: string | null;
          renewal_window: string | null;
          subscription_code: string | null;
          subscription_id: string | null;
          subscription_status: Database['platform']['Enums']['subscription_status'] | null;
          suspension_pending: boolean | null;
          tenant_id: string | null;
          tenant_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      v_renewal_pipeline: {
        Row: {
          auto_suspend: boolean | null;
          billed_organization_id: string | null;
          billed_organization_name: string | null;
          billing_interval: Database['platform']['Enums']['billing_interval'] | null;
          collection_method: Database['platform']['Enums']['collection_method'] | null;
          critical_alerts: number | null;
          currency: string | null;
          current_mrr: number | null;
          days_to_renewal: number | null;
          grace_period_days: number | null;
          in_grace: boolean | null;
          is_past_due: boolean | null;
          open_alerts: number | null;
          product_code: string | null;
          product_short_name: string | null;
          provider_account_code: string | null;
          renewal_on: string | null;
          renewal_window: string | null;
          subscription_code: string | null;
          subscription_id: string | null;
          subscription_status: Database['platform']['Enums']['subscription_status'] | null;
          suspension_pending: boolean | null;
          tenant_id: string | null;
          tenant_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      v_saas_provisioning: {
        Row: {
          adapter_key: Database['platform']['Enums']['integration_adapter'] | null;
          attempt_count: number | null;
          base_url: string | null;
          cancel_reason: string | null;
          cancelled_at: string | null;
          capabilities: string[] | null;
          completed_at: string | null;
          contract_version: string | null;
          correlation_id: string | null;
          created_at: string | null;
          customer_organization_id: string | null;
          customer_organization_name: string | null;
          deployment_code: string | null;
          deployment_health: Database['platform']['Enums']['deployment_health'] | null;
          deployment_mode: Database['platform']['Enums']['deployment_mode'] | null;
          deployment_status: Database['platform']['Enums']['deployment_target_status'] | null;
          deployment_target_id: string | null;
          external_company_id: string | null;
          external_organization_id: string | null;
          external_reference: string | null;
          external_tenant_id: string | null;
          id: string | null;
          idempotency_key: string | null;
          integration_code: string | null;
          integration_type: Database['platform']['Enums']['integration_type'] | null;
          last_error_code: string | null;
          last_error_message: string | null;
          managing_organization_id: string | null;
          managing_organization_name: string | null;
          mapping_id: string | null;
          mapping_metadata: Json | null;
          mapping_status: Database['platform']['Enums']['tenant_product_mapping_status'] | null;
          max_attempts: number | null;
          product_code: string | null;
          product_configuration: Json | null;
          product_integration_id: string | null;
          product_short_name: string | null;
          provider_http_status: number | null;
          provisioning_environment:
            Database['platform']['Enums']['provisioning_environment'] | null;
          provisioning_policy: Database['platform']['Enums']['provisioning_policy'] | null;
          registered_manually: boolean | null;
          request_version: number | null;
          requested_at: string | null;
          requested_by: string | null;
          requested_by_name: string | null;
          saas_product_id: string | null;
          started_at: string | null;
          status: Database['platform']['Enums']['saas_provisioning_status'] | null;
          subscription_id: string | null;
          tenant_id: string | null;
          tenant_name: string | null;
          tenant_slug: string | null;
          updated_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'saas_provisioning_requests_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'deployment_targets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_provisioning_targets';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_deployment_target_id_fkey';
            columns: ['deployment_target_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['deployment_target_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_product_integration_id_fkey';
            columns: ['product_integration_id'];
            isOneToOne: false;
            referencedRelation: 'product_integrations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_dashboard';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_renewal_pipeline';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_collection';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_documents';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_subscription_mrr';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['subscription_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'saas_provisioning_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'tenants_customer_organization_id_fkey';
            columns: ['customer_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      v_subscription_collection: {
        Row: {
          auto_charge: boolean | null;
          auto_suspend: boolean | null;
          billed_organization_id: string | null;
          billed_organization_name: string | null;
          billing_interval: Database['platform']['Enums']['billing_interval'] | null;
          collection_method: Database['platform']['Enums']['collection_method'] | null;
          currency: string | null;
          document_lead_days: number | null;
          effective_from: string | null;
          ends_on: string | null;
          grace_period_days: number | null;
          invoice_lead_days: number | null;
          payment_due_days: number | null;
          product_code: string | null;
          product_short_name: string | null;
          profile_id: string | null;
          profile_missing: boolean | null;
          profile_status: Database['platform']['Enums']['collection_profile_status'] | null;
          provider_account_code: string | null;
          provider_account_id: string | null;
          provider_environment: Database['platform']['Enums']['provider_environment'] | null;
          provider_kind: Database['platform']['Enums']['provider_kind'] | null;
          renewal_notice_days: number | null;
          requires_purchase_order: boolean | null;
          requires_service_order: boolean | null;
          saas_product_id: string | null;
          started_on: string | null;
          subscription_code: string | null;
          subscription_id: string | null;
          subscription_status: Database['platform']['Enums']['subscription_status'] | null;
          tenant_id: string | null;
          tenant_name: string | null;
          tenant_slug: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_collection_profiles_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_provider_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscription_collection_profiles_provider_account_id_fkey';
            columns: ['provider_account_id'];
            isOneToOne: false;
            referencedRelation: 'v_provider_account_routes';
            referencedColumns: ['provider_account_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      v_subscription_documents: {
        Row: {
          approved_at: string | null;
          billed_organization_id: string | null;
          billed_organization_name: string | null;
          collection_method: Database['platform']['Enums']['collection_method'] | null;
          document_amount: number | null;
          document_currency: string | null;
          document_id: string | null;
          document_lead_days: number | null;
          document_number: string | null;
          document_ok: boolean | null;
          document_required: boolean | null;
          document_status: Database['platform']['Enums']['commercial_document_status'] | null;
          document_type: Database['platform']['Enums']['commercial_document_type'] | null;
          external_file_ref: string | null;
          product_code: string | null;
          received_at: string | null;
          requested_at: string | null;
          requires_purchase_order: boolean | null;
          requires_service_order: boolean | null;
          subscription_code: string | null;
          subscription_id: string | null;
          tenant_name: string | null;
          valid_from: string | null;
          valid_to: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_commercial_documents_currency_fk';
            columns: ['document_currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      v_subscription_mrr: {
        Row: {
          billed_organization_id: string | null;
          currency: string | null;
          deployment_mode: Database['platform']['Enums']['deployment_mode'] | null;
          managing_organization_id: string | null;
          mrr: number | null;
          saas_product_id: string | null;
          subscription_id: string | null;
          tenant_id: string | null;
          tenant_type: Database['platform']['Enums']['tenant_type'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_billed_organization_id_fkey';
            columns: ['billed_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
          {
            foreignKeyName: 'subscriptions_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'subscriptions_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_billing_contact_readiness';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_finance';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_partner_margin';
            referencedColumns: ['organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['customer_organization_id'];
          },
          {
            foreignKeyName: 'tenants_managing_organization_id_fkey';
            columns: ['managing_organization_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['managing_organization_id'];
          },
        ];
      };
      v_tenant_addon_history: {
        Row: {
          active: boolean | null;
          addon_code: string | null;
          addon_name: string | null;
          approved_at: string | null;
          approved_by: string | null;
          billing_model: string | null;
          billing_valid_to: string | null;
          catalog_lifecycle_status: string | null;
          company_id: string | null;
          company_name: string | null;
          currency: string | null;
          effective_from: string | null;
          effective_to: string | null;
          id: string | null;
          request_source: string | null;
          requested_at: string | null;
          requested_by: string | null;
          saas_product_id: string | null;
          status: string | null;
          status_reason: string | null;
          subscription_item_id: string | null;
          tenant_id: string | null;
          tenant_slug: string | null;
          unit_amount: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_items_currency_fk';
            columns: ['currency'];
            isOneToOne: false;
            referencedRelation: 'currencies';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'tenant_addons_addon_code_fkey';
            columns: ['addon_code'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'tenant_addons_addon_code_fkey';
            columns: ['addon_code'];
            isOneToOne: false;
            referencedRelation: 'v_catalog_item_current_prices';
            referencedColumns: ['catalog_item_code'];
          },
          {
            foreignKeyName: 'tenant_addons_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_addons_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_addons_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'v_company_markets';
            referencedColumns: ['company_id'];
          },
          {
            foreignKeyName: 'tenant_addons_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_addons_subscription_item_id_fkey';
            columns: ['subscription_item_id'];
            isOneToOne: false;
            referencedRelation: 'subscription_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_addons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_addons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_addons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenant_addons_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      v_tenant_costs: {
        Row: {
          allocation_path: string | null;
          category: Database['platform']['Enums']['cost_category'] | null;
          cost_amount: number | null;
          currency: string | null;
          period_end: string | null;
          period_start: string | null;
          tenant_id: string | null;
        };
        Relationships: [];
      };
      v_tenant_entitlements: {
        Row: {
          app_active: boolean | null;
          capability_code: string | null;
          capability_id: string | null;
          company_ids: string[] | null;
          desired_dirty: boolean | null;
          desired_revision: number | null;
          enabled: boolean | null;
          enforcement: string | null;
          included: number | null;
          kind: string | null;
          last_change_at: string | null;
          meter_code: string | null;
          period: string | null;
          product_code: string | null;
          saas_product_id: string | null;
          scope_level: string | null;
          sources: string[] | null;
          tenant_id: string | null;
          tenant_slug: string | null;
          unit: string | null;
          value: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'tenants_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
        ];
      };
      v_tenant_margin: {
        Row: {
          collected_revenue: number | null;
          commission_total: number | null;
          currency: string | null;
          deployment_mode: Database['platform']['Enums']['deployment_mode'] | null;
          direct_cost: number | null;
          gross_margin: number | null;
          mrr: number | null;
          name: string | null;
          product_code: string | null;
          slug: string | null;
          tenant_id: string | null;
          tenant_type: Database['platform']['Enums']['tenant_type'] | null;
        };
        Relationships: [];
      };
      v_tenant_overview: {
        Row: {
          activated_at: string | null;
          admin_activated_at: string | null;
          admin_email: string | null;
          created_at: string | null;
          currency: string | null;
          customer_name: string | null;
          customer_organization_id: string | null;
          deployment_mode: Database['platform']['Enums']['deployment_mode'] | null;
          deployment_provider: Database['platform']['Enums']['infra_provider'] | null;
          deployment_region: string | null;
          deployment_target_code: string | null;
          deployment_target_id: string | null;
          environment: Database['platform']['Enums']['environment_kind'] | null;
          managing_name: string | null;
          managing_organization_id: string | null;
          market_code: string | null;
          mrr: number | null;
          name: string | null;
          plan_name: string | null;
          product_code: string | null;
          product_lockup: string | null;
          product_short_name: string | null;
          saas_product_id: string | null;
          slug: string | null;
          status: Database['platform']['Enums']['tenant_status'] | null;
          subscription_id: string | null;
          tenant_id: string | null;
          tenant_type: Database['platform']['Enums']['tenant_type'] | null;
        };
        Relationships: [];
      };
      v_usage_alerts: {
        Row: {
          ack_id: string | null;
          ack_note: string | null;
          acknowledged: boolean | null;
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          acknowledged_by_name: string | null;
          aggregate_id: string | null;
          code: string | null;
          created_at: string | null;
          detail: Json | null;
          id: string | null;
          saas_product_id: string | null;
          tenant_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_alert_acks_acknowledged_by_fkey';
            columns: ['acknowledged_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alerts_aggregate_id_fkey';
            columns: ['aggregate_id'];
            isOneToOne: false;
            referencedRelation: 'usage_period_aggregates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alerts_aggregate_id_fkey';
            columns: ['aggregate_id'];
            isOneToOne: false;
            referencedRelation: 'v_usage_period_aggregates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alerts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alerts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_alerts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_alerts_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_alerts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_alerts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'usage_alerts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'usage_alerts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
      v_usage_period_aggregates: {
        Row: {
          allowance_included: number | null;
          allowance_status: string | null;
          closing_at: string | null;
          event_count: number | null;
          finalized_at: string | null;
          finalized_by: string | null;
          id: string | null;
          is_billable: boolean | null;
          late_event_count: number | null;
          meter_code: string | null;
          meter_id: string | null;
          overage_policy: string | null;
          overage_quantity: number | null;
          period_end: string | null;
          period_start: string | null;
          product_code: string | null;
          quantity: number | null;
          saas_product_id: string | null;
          source_hash: string | null;
          status: string | null;
          tenant_id: string | null;
          tenant_slug: string | null;
          unit: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_period_aggregates_finalized_by_fkey';
            columns: ['finalized_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_meter_id_fkey';
            columns: ['meter_id'];
            isOneToOne: false;
            referencedRelation: 'usage_meters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'saas_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_finance';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_product_margin';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_saas_product_id_fkey';
            columns: ['saas_product_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['saas_product_id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_entitlements';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_margin';
            referencedColumns: ['tenant_id'];
          },
          {
            foreignKeyName: 'usage_period_aggregates_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'v_tenant_overview';
            referencedColumns: ['tenant_id'];
          },
        ];
      };
    };
    Functions: {
      accept_my_invitations: { Args: Record<PropertyKey, never>; Returns: number };
      acknowledge_usage_alert: { Args: { p_alert_id: string; p_note?: string }; Returns: Json };
      admin_list_users: {
        Args: { p_scope_org_id?: string; p_search?: string; p_user_id?: string };
        Returns: {
          banned: boolean;
          created_at: string;
          email: string;
          email_confirmed_at: string;
          full_name: string;
          id: string;
          invited_at: string;
          is_active: boolean;
          job_title: string;
          last_sign_in_at: string;
          organizations: Json;
          phone: string;
          platform_role: Database['platform']['Enums']['platform_role'];
          platform_role_active: boolean;
          product_ownerships: Json;
          provisioning_roles: Json;
          sales_agent: Json;
          tenants: Json;
        }[];
      };
      admin_update_profile: {
        Args: { p_full_name: string; p_job_title?: string; p_phone?: string; p_user_id: string };
        Returns: string;
      };
      ai_credit_applicable_policies: {
        Args: { p_at: string; p_tenant_id: string };
        Returns: {
          catalog_item_id: string | null;
          created_at: string;
          created_by: string | null;
          expiry_policy: string | null;
          id: string;
          included_credits: number | null;
          overage_mode: string | null;
          plan_id: string | null;
          pool_scope: string | null;
          reason: string;
          rollover_policy: string | null;
          saas_product_id: string;
          source_type: string;
          valid_from: string;
          valid_to: string | null;
        }[];
        SetofOptions: {
          from: '*';
          to: 'ai_credit_policies';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      ai_credit_assert_pool: { Args: { p_pool_key: string; p_tenant_id: string }; Returns: string };
      ai_credit_pool_key: { Args: { p_product_id: string; p_scope: string }; Returns: string };
      ai_credit_weights_snapshot: { Args: { p_at: string; p_product_id: string }; Returns: Json };
      apply_due_suspensions: { Args: { p_as_of?: string; p_mode?: string }; Returns: Json };
      approve_commercial_document: {
        Args: { p_document_id: string; p_notes?: string; p_valid_to?: string };
        Returns: undefined;
      };
      approve_tenant_addon: {
        Args: { p_reason: string; p_tenant_addon_id: string };
        Returns: Json;
      };
      archive_saas_product: {
        Args: { p_product_id: string; p_reason?: string };
        Returns: undefined;
      };
      assert_active_profile: { Args: { p_user_id: string }; Returns: string };
      assert_can_resend_invitation: {
        Args: { p_user_id: string };
        Returns: {
          accepted_at: string | null;
          access_grant: NonNullable<Json>;
          created_at: string;
          delivery: string;
          email: string;
          full_name: string | null;
          id: string;
          invited_by: string | null;
          revoked_at: string | null;
          status: string;
          user_id: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'user_invitations';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      assert_entitlement_sync_service: { Args: Record<PropertyKey, never>; Returns: undefined };
      assert_org_role_assignable: {
        Args: {
          p_existing_role?: Database['platform']['Enums']['org_role'];
          p_org: string;
          p_role: Database['platform']['Enums']['org_role'];
          p_target?: string;
        };
        Returns: undefined;
      };
      assert_tenant_member_domain: {
        Args: { p_email: string; p_tenant_id: string };
        Returns: undefined;
      };
      assert_user_grant: { Args: { p_email: string; p_grant: Json }; Returns: Json };
      attach_tenant_to_target: {
        Args: {
          p_deployment_target_id: string;
          p_is_primary?: boolean;
          p_notes?: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      authorize_invitation_resend: { Args: { p_user_id: string }; Returns: Json };
      authorize_user_invitation: { Args: { p_email: string; p_grant: Json }; Returns: Json };
      begin_card_charge_attempt: {
        Args: {
          p_actor?: string;
          p_as_of?: string;
          p_ignore_schedule?: boolean;
          p_invoice_id: string;
          p_trigger_source: string;
        };
        Returns: Json;
      };
      begin_saas_provisioning: {
        Args: { p_actor_id?: string; p_actor_role?: string; p_request_id: string };
        Returns: Json;
      };
      billing_shadow_expected_lines: {
        Args: { p_period_start: string; p_saas_product_code: string; p_tenant_id: string };
        Returns: Json;
      };
      build_provisioning_idempotency_key: {
        Args: { p_product_id: string; p_tenant_id: string; p_version: number };
        Returns: string;
      };
      can_certify_saas_provisioning: { Args: { p_request_id: string }; Returns: boolean };
      can_check_deployment_health: { Args: { p_deployment_target_id: string }; Returns: boolean };
      can_execute_saas_provisioning: { Args: { p_request_id: string }; Returns: boolean };
      can_manage_commercial: { Args: Record<PropertyKey, never>; Returns: boolean };
      can_manage_platform_entities: { Args: Record<PropertyKey, never>; Returns: boolean };
      can_manage_regional_catalog: { Args: Record<PropertyKey, never>; Returns: boolean };
      can_manage_subscription_documents: { Args: { p_subscription_id: string }; Returns: boolean };
      can_manage_tenant: { Args: { p_tenant: string }; Returns: boolean };
      can_read_commercial_cutover: { Args: { p_saas_product_id: string }; Returns: boolean };
      can_read_entitlement_sync: { Args: { p_tenant_id: string }; Returns: boolean };
      can_read_finance: { Args: Record<PropertyKey, never>; Returns: boolean };
      can_read_saas_provisioning: { Args: { p_request_id: string }; Returns: boolean };
      can_read_tenant: { Args: { p_tenant: string }; Returns: boolean };
      can_run_provisioning: { Args: Record<PropertyKey, never>; Returns: boolean };
      can_sync_entitlements: { Args: { p_tenant_id: string }; Returns: boolean };
      cancel_commercial_document: {
        Args: { p_document_id: string; p_reason?: string };
        Returns: undefined;
      };
      cancel_saas_provisioning_request: {
        Args: { p_reason?: string; p_request_id: string };
        Returns: string;
      };
      cancel_tenant_addon: {
        Args: { p_reason: string; p_tenant_addon_id: string };
        Returns: undefined;
      };
      card_on_file_due_invoices: {
        Args: {
          p_as_of?: string;
          p_ignore_schedule?: boolean;
          p_invoice_id?: string;
          p_limit?: number;
        };
        Returns: {
          balance: number;
          billing_email: string;
          currency: string;
          due_date: string;
          external_customer_id: string;
          external_payment_method_id: string;
          invoice_id: string;
          invoice_number: string;
          next_attempt_no: number;
          organization_id: string;
          payment_method_id: string;
          provider_account_id: string;
          subscription_id: string;
        }[];
      };
      card_on_file_retry_at: {
        Args: { p_attempt_no: number; p_due_date: string };
        Returns: string;
      };
      check_provisioning_preconditions: { Args: { p_request_id: string }; Returns: Json };
      claim_entitlement_push_for: {
        Args: {
          p_lease_seconds?: number;
          p_product_id: string;
          p_tenant_id: string;
          p_worker: string;
        };
        Returns: {
          attempt: number;
          checksum: string;
          document: Json;
          saas_product_id: string;
          snapshot_version: number;
          tenant_id: string;
        }[];
      };
      claim_entitlement_pushes: {
        Args: { p_lease_seconds?: number; p_limit?: number; p_worker: string };
        Returns: {
          attempt: number;
          checksum: string;
          document: Json;
          saas_product_id: string;
          snapshot_version: number;
          tenant_id: string;
        }[];
      };
      claim_entitlement_verification_for: {
        Args: {
          p_lease_seconds?: number;
          p_product_id: string;
          p_tenant_id: string;
          p_worker: string;
        };
        Returns: boolean;
      };
      claim_entitlement_verifications: {
        Args: {
          p_lease_seconds?: number;
          p_limit?: number;
          p_resample_after?: string;
          p_worker: string;
        };
        Returns: {
          desired_checksum: string;
          desired_version: number;
          saas_product_id: string;
          state: string;
          tenant_id: string;
        }[];
      };
      claim_invoice_charge_lock: {
        Args: {
          p_holder: string;
          p_holder_ref?: string;
          p_invoice_id: string;
          p_ttl_seconds?: number;
        };
        Returns: Json;
      };
      clear_catalog_item_usage_binding: {
        Args: { p_catalog_item_code: string; p_reason: string };
        Returns: Json;
      };
      clear_payment_provider_secret: {
        Args: { p_account_id: string; p_reason: string };
        Returns: Json;
      };
      close_entitlement_grant: {
        Args: { p_grant_id: string; p_reason: string; p_valid_to: string };
        Returns: undefined;
      };
      close_usage_aggregate: { Args: { p_aggregate_id: string; p_reason: string }; Returns: Json };
      close_usage_periods: { Args: { p_now?: string }; Returns: number };
      collections_by_month: {
        Args: { p_from?: string; p_organization_id?: string; p_to?: string };
        Returns: {
          amount: number;
          currency: string;
          month: string;
          payment_count: number;
        }[];
      };
      commercial_cutover_axes: {
        Args: Record<PropertyKey, never>;
        Returns: {
          cutover_state_billing: string;
          cutover_state_entitlements: string;
          integration_code: string;
          integration_id: string;
          integration_name: string;
          product_code: string;
          product_short_name: string;
          saas_product_id: string;
          updated_at: string;
          usage_ingest_enabled: boolean;
        }[];
      };
      commercial_cutover_history: {
        Args: Record<PropertyKey, never>;
        Returns: {
          actor_name: string;
          actor_user_id: string;
          axis: string;
          from_state: string;
          id: number;
          integration_code: string;
          integration_id: string;
          occurred_at: string;
          product_code: string;
          reason: string;
          saas_product_id: string;
          to_state: string;
        }[];
      };
      commission_summary: { Args: { p_search?: string; p_status?: string }; Returns: Json };
      complete_card_charge_attempt: {
        Args: {
          p_amount?: number;
          p_attempt_id: string;
          p_currency?: string;
          p_error_code?: string;
          p_external_charge_id?: string;
          p_paid_at?: string;
          p_succeeded: boolean;
        };
        Returns: Json;
      };
      complete_saas_provisioning: {
        Args: {
          p_actor_id?: string;
          p_actor_role?: string;
          p_external_company_id?: string;
          p_external_organization_id?: string;
          p_external_reference?: string;
          p_external_tenant_id: string;
          p_request_id: string;
          p_resources?: Json;
        };
        Returns: Json;
      };
      complete_scheduled_addon_cancellations: { Args: { p_as_of?: string }; Returns: number };
      compute_all_partner_fee_statements: { Args: { p_period_start: string }; Returns: Json };
      compute_entitlements: {
        Args: { p_at?: string; p_product_id: string; p_tenant_id: string };
        Returns: {
          capability_code: string;
          capability_id: string;
          company_ids: string[];
          enabled: boolean;
          enforcement: string;
          included: number;
          kind: string;
          meter_code: string;
          period: string;
          scope_level: string;
          sources: string[];
          unit: string;
          value: number;
        }[];
      };
      compute_partner_fee_statement: {
        Args: { p_partner_id: string; p_period_start: string };
        Returns: Json;
      };
      configure_deployment_provisioning: {
        Args: {
          p_base_url?: string;
          p_credential_profile_id?: string;
          p_deployment_target_id: string;
          p_product_integration_id?: string;
          p_provisioning_enabled?: boolean;
          p_provisioning_environment?: Database['platform']['Enums']['provisioning_environment'];
          p_provisioning_policy?: Database['platform']['Enums']['provisioning_policy'];
          p_provisioning_status?: Database['platform']['Enums']['deployment_target_status'];
          p_retry_count?: number;
          p_timeout_ms?: number;
        };
        Returns: string;
      };
      configure_entitlements_integration: {
        Args: {
          p_entitlements_path: string;
          p_integration_id: string;
          p_manifest_path: string;
          p_read_scope: string;
          p_write_scope: string;
        };
        Returns: string;
      };
      configure_usage_ingest_credential: {
        Args: {
          p_audience?: string;
          p_enabled: boolean;
          p_environment: Database['platform']['Enums']['provisioning_environment'];
          p_issuer: string;
          p_kid?: string;
          p_product_code: string;
          p_public_key_ref: string;
        };
        Returns: string;
      };
      confirm_manual_payment: {
        Args: {
          p_amount: number;
          p_invoice_id: string;
          p_method?: string;
          p_notes?: string;
          p_paid_at?: string;
          p_reference: string;
        };
        Returns: Json;
      };
      consume_m2m_jti: {
        Args: { p_expires_at: string; p_issuer: string; p_jti: string };
        Returns: boolean;
      };
      cost_summary: { Args: { p_scope?: string; p_search?: string }; Returns: Json };
      create_ai_credit_policy: {
        Args: {
          p_included_credits: number;
          p_overage_mode: string;
          p_pool_scope: string;
          p_reason: string;
          p_source_code: string;
          p_source_type: string;
          p_valid_from: string;
        };
        Returns: string;
      };
      create_entitlement_grant: {
        Args: {
          p_capability_code: string;
          p_grant_value: Json;
          p_reason?: string;
          p_source_code: string;
          p_source_type: string;
          p_valid_from?: string;
        };
        Returns: string;
      };
      create_entitlement_override: {
        Args: {
          p_capability_code: string;
          p_expires_at: string;
          p_grant_value: Json;
          p_override_type: string;
          p_reason: string;
          p_starts_at?: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      create_payment_link: {
        Args: {
          p_allow_card_enrollment?: boolean;
          p_expires_in_days?: number;
          p_organization_id: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      create_saas_provisioning_request: {
        Args: {
          p_environment: Database['platform']['Enums']['provisioning_environment'];
          p_max_attempts?: number;
          p_subscription_id?: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      create_sales_attribution: {
        Args: {
          p_attribution_pct: number;
          p_channel_organization_id?: string;
          p_commission_plan_id?: string;
          p_customer_organization_id: string;
          p_notes?: string;
          p_saas_product_id: string;
          p_sales_agent_id: string;
          p_source?: Database['platform']['Enums']['attribution_source'];
          p_subscription_id?: string;
          p_tenant_id?: string;
          p_valid_from?: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      create_subscription: {
        Args: {
          p_billed_organization_id: string;
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_channel_margin_rate?: number;
          p_code?: string;
          p_currency?: string;
          p_ends_on?: string;
          p_market_code: string;
          p_metadata?: Json;
          p_notes?: string;
          p_plan_id: string;
          p_quantity?: number;
          p_saas_product_id: string;
          p_started_on?: string;
          p_status?: Database['platform']['Enums']['subscription_status'];
          p_tenant_id?: string;
        };
        Returns: string;
      };
      create_tenant: {
        Args: {
          p_admin_email: string;
          p_company_id?: string;
          p_customer_organization_id: string;
          p_deployment_mode?: Database['platform']['Enums']['deployment_mode'];
          p_managing_organization_id?: string;
          p_metadata?: Json;
          p_name: string;
          p_saas_product_code: string;
          p_slug: string;
          p_tenant_type?: Database['platform']['Enums']['tenant_type'];
        };
        Returns: string;
      };
      current_catalog_item_price: {
        Args: {
          p_as_of?: string;
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_catalog_item_id: string;
          p_charge_kind: Database['platform']['Enums']['charge_kind'];
          p_currency: string;
          p_market_id: string;
        };
        Returns: number;
      };
      current_catalog_item_price_id: {
        Args: {
          p_as_of?: string;
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_catalog_item_id: string;
          p_charge_kind: Database['platform']['Enums']['charge_kind'];
          p_currency: string;
          p_market_id: string;
        };
        Returns: string;
      };
      current_plan_price: {
        Args: {
          p_as_of?: string;
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_charge_kind: Database['platform']['Enums']['charge_kind'];
          p_currency: string;
          p_market_id: string;
          p_plan_id: string;
        };
        Returns: number;
      };
      dashboard_summary: { Args: Record<PropertyKey, never>; Returns: Json };
      deactivate_commission_rule: {
        Args: { p_reason?: string; p_rule_id: string; p_valid_to?: string };
        Returns: undefined;
      };
      deactivate_product_owner: { Args: { p_id: string }; Returns: string };
      deactivate_user: { Args: { p_reason: string; p_user_id: string }; Returns: Json };
      deployment_health_context: { Args: { p_deployment_target_id: string }; Returns: Json };
      effective_config: { Args: { p_company: string }; Returns: Json };
      effective_tenant_config: { Args: { p_tenant: string }; Returns: Json };
      end_ai_credit_policy: {
        Args: { p_policy_id: string; p_reason: string; p_valid_to: string };
        Returns: Json;
      };
      end_product_agreement: {
        Args: { p_agreement_id: string; p_reason?: string; p_valid_to?: string };
        Returns: undefined;
      };
      end_sales_attribution: {
        Args: { p_attribution_id: string; p_reason?: string; p_valid_to?: string };
        Returns: undefined;
      };
      end_subscription_item: {
        Args: { p_item_id: string; p_valid_to?: string };
        Returns: undefined;
      };
      enqueue_provisioning_request: {
        Args: {
          p_action: Database['platform']['Enums']['provisioning_action'];
          p_deployment_target_id?: string;
          p_idempotency_key?: string;
          p_mode?: string;
          p_payload?: Json;
          p_saas_product_id?: string;
          p_tenant_id?: string;
        };
        Returns: string;
      };
      enroll_card_on_file: {
        Args: {
          p_brand: string;
          p_client_fingerprint?: string;
          p_exp_month?: number;
          p_exp_year?: number;
          p_external_customer_id: string;
          p_external_payment_method_id: string;
          p_last4: string;
          p_link_id: string;
          p_provider_account_id: string;
          p_terms_version?: string;
        };
        Returns: Json;
      };
      entitlement_checksum: { Args: { p_document: Json }; Returns: string };
      entitlement_delivery_context: {
        Args: { p_product_id: string; p_tenant_id: string };
        Returns: Json;
      };
      entitlement_gate_state: {
        Args: { p_product_id: string; p_tenant_id: string };
        Returns: string;
      };
      entitlement_integration_for: {
        Args: { p_product_id: string; p_tenant_id: string };
        Returns: string;
      };
      entitlement_is_pushable: { Args: { p_failures: number; p_state: string }; Returns: boolean };
      entitlement_issue_candidates: {
        Args: { p_limit?: number; p_sweep?: boolean };
        Returns: {
          saas_product_id: string;
          tenant_id: string;
        }[];
      };
      entitlement_push_transition: {
        Args: { p_failures: number; p_result: string };
        Returns: {
          failures: number;
          state: string;
        }[];
      };
      entitlement_registry_drift: { Args: { p_product_id: string }; Returns: boolean };
      entitlement_registry_targets: {
        Args: Record<PropertyKey, never>;
        Returns: {
          product_integration_id: string;
          saas_product_id: string;
          tenant_id: string;
        }[];
      };
      entitlement_retry_delay: { Args: { p_failures: number }; Returns: string };
      entitlement_snapshot_content: {
        Args: { p_at: string; p_product_id: string; p_tenant_id: string };
        Returns: Json;
      };
      entitlement_verify_failure_transition: {
        Args: { p_failures: number; p_result: string; p_state: string };
        Returns: {
          failures: number;
          state: string;
        }[];
      };
      entitlement_verify_verdict: {
        Args: {
          p_applied_checksum: string;
          p_applied_status: string;
          p_applied_version: number;
          p_desired_checksum: string;
          p_desired_version: number;
          p_registry_drift: boolean;
        };
        Returns: string;
      };
      entitlements_enrollment: {
        Args: { p_product_id: string; p_tenant_id: string };
        Returns: string;
      };
      entitlements_push_enabled: {
        Args: { p_product_id: string; p_tenant_id: string };
        Returns: boolean;
      };
      evaluate_provisioning_policy: {
        Args: {
          p_policy: Database['platform']['Enums']['provisioning_policy'];
          p_subscription_id: string;
        };
        Returns: Json;
      };
      executive_mrr_at: {
        Args: { p_at: string; p_rate_date?: string; p_reporting_currency?: string };
        Returns: {
          billed_organization_id: string;
          conversion_status: string;
          fx_is_demo: boolean;
          fx_rate_date: string;
          market_id: string;
          native_currency: string;
          native_mrr: number;
          reporting_currency: string;
          reporting_mrr: number;
          saas_product_id: string;
          subscription_id: string;
          tenant_id: string;
        }[];
      };
      executive_mrr_mix: {
        Args: { p_dimension?: string; p_month?: string; p_reporting_currency?: string };
        Returns: {
          active_customers: number;
          active_subscriptions: number;
          as_of: string;
          complete: boolean;
          dimension: string;
          group_key: string;
          group_label: string;
          missing_currencies: string[];
          month: string;
          mrr: number;
          mrr_native: Json;
          reporting_currency: string;
          share: number;
        }[];
      };
      executive_mrr_movement_customers: {
        Args: { p_month?: string; p_reporting_currency?: string };
        Returns: {
          as_of: string;
          billed_organization_id: string;
          closing_mrr: number;
          complete: boolean;
          delta_mrr: number;
          month: string;
          movement: string;
          opening_mrr: number;
          organization_name: string;
          reporting_currency: string;
        }[];
      };
      executive_mrr_movements: {
        Args: { p_month?: string; p_reporting_currency?: string };
        Returns: {
          as_of: string;
          churn_mrr: number;
          churned_customers: number;
          closing_mrr: number;
          complete: boolean;
          contraction_customers: number;
          contraction_mrr: number;
          expansion_customers: number;
          expansion_mrr: number;
          fx_revaluation: number;
          month: string;
          new_customers: number;
          new_mrr: number;
          opening_mrr: number;
          prior_closing_mrr: number;
          reporting_currency: string;
        }[];
      };
      executive_mrr_series: {
        Args: { p_from?: string; p_reporting_currency?: string; p_to?: string };
        Returns: {
          active_customers: number;
          active_subscriptions: number;
          arr: number;
          as_of: string;
          complete: boolean;
          fx_is_demo: boolean;
          is_partial: boolean;
          missing_currencies: string[];
          month: string;
          mrr: number;
          mrr_native: Json;
          reporting_currency: string;
        }[];
      };
      executive_receivables_aging: {
        Args: { p_as_of?: string; p_reporting_currency?: string };
        Returns: {
          aging_bucket: string;
          as_of: string;
          balance: number;
          balance_native: Json;
          bucket_order: number;
          complete: boolean;
          fx_is_demo: boolean;
          invoice_count: number;
          missing_currencies: string[];
          reporting_currency: string;
        }[];
      };
      executive_reporting_config: {
        Args: { p_reporting_currency?: string };
        Returns: {
          fx_max_rate_age_days: number;
          reporting_currency: string;
        }[];
      };
      expire_ai_credits: {
        Args: { p_period_start: string; p_pool_key: string; p_tenant_id: string };
        Returns: number;
      };
      expire_commercial_documents: { Args: { p_as_of?: string }; Returns: number };
      fail_saas_provisioning: {
        Args: {
          p_actor_id?: string;
          p_actor_role?: string;
          p_detail?: Json;
          p_error_code: string;
          p_http_status?: number;
          p_message?: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      finalize_due_usage_aggregates: { Args: { p_limit?: number }; Returns: number };
      finalize_usage_aggregate: { Args: { p_aggregate_id: string }; Returns: Json };
      finance_consolidated: {
        Args: {
          p_as_of?: string;
          p_currency?: string;
          p_group_by?: string;
          p_market_code?: string;
          p_organization_id?: string;
          p_period_end?: string;
          p_period_start?: string;
          p_reporting_currency?: string;
          p_saas_product_id?: string;
        };
        Returns: Json;
      };
      finance_reporting_rows: {
        Args: {
          p_as_of?: string;
          p_currency?: string;
          p_group_by?: string;
          p_market_code?: string;
          p_organization_id?: string;
          p_period_end?: string;
          p_period_start?: string;
          p_reporting_currency?: string;
          p_saas_product_id?: string;
        };
        Returns: {
          conversion_status: string;
          fx_is_demo: boolean;
          fx_method: string;
          fx_rate: number;
          fx_rate_date: string;
          group_key: string;
          group_label: string;
          metric: string;
          native_amount: number;
          native_currency: string;
          reporting_amount: number;
          reporting_currency: string;
        }[];
      };
      find_reusable_provider_plan: {
        Args: {
          p_amount: number;
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_currency: string;
          p_plan_id: string;
          p_provider_account_id: string;
        };
        Returns: string;
      };
      fx_convert: {
        Args: {
          p_amount: number;
          p_as_of: string;
          p_from: string;
          p_max_age_days?: number;
          p_to: string;
        };
        Returns: {
          amount: number;
          is_demo: boolean;
          rate: number;
          rate_date: string;
          rate_id: string;
          status: string;
        }[];
      };
      fx_rate_lookup: {
        Args: { p_as_of: string; p_base: string; p_max_age_days?: number; p_quote: string };
        Returns: {
          is_demo: boolean;
          rate: number;
          rate_date: string;
          rate_id: string;
          source: Database['platform']['Enums']['fx_rate_source'];
          status: string;
        }[];
      };
      generate_commission_events: { Args: { p_payment_id: string }; Returns: number };
      get_subscription_billing_status: {
        Args: { p_period_start?: string; p_subscription_id: string };
        Returns: Json;
      };
      grant_platform_role: {
        Args: {
          p_reason?: string;
          p_role: Database['platform']['Enums']['platform_role'];
          p_user_id: string;
        };
        Returns: string;
      };
      grant_provisioning_role: {
        Args: {
          p_notes?: string;
          p_role: Database['platform']['Enums']['provisioning_role'];
          p_user_id: string;
        };
        Returns: string;
      };
      has_org_commercial_access: { Args: { p_org: string }; Returns: boolean };
      has_platform_permission: { Args: { p_code: string }; Returns: boolean };
      has_platform_role: {
        Args: { p_role: Database['platform']['Enums']['platform_role'] };
        Returns: boolean;
      };
      has_product_permission: { Args: { p_code: string; p_product: string }; Returns: boolean };
      import_capability_manifest: {
        Args: { p_manifest: Json; p_product_code: string };
        Returns: Json;
      };
      ingest_usage_events: {
        Args: { p_batch_id: string; p_environment: string; p_events: Json; p_product_code: string };
        Returns: Json;
      };
      integration_capabilities: {
        Args: {
          p_adapter_key: Database['platform']['Enums']['integration_adapter'];
          p_read_scope: string;
          p_status_path_template: string;
        };
        Returns: string[];
      };
      invoice_balance: { Args: { p_invoice_id: string }; Returns: number };
      invoice_card_account_eligible: {
        Args: { p_account_id: string; p_invoice_id: string };
        Returns: boolean;
      };
      invoice_summary: {
        Args: {
          p_aging?: string;
          p_organization_id?: string;
          p_search?: string;
          p_status?: string;
        };
        Returns: Json;
      };
      is_blocked_provisioning_host: { Args: { p_host: string }; Returns: boolean };
      is_currency_active: { Args: { p_currency: string }; Returns: boolean };
      is_currency_allowed_in_market: {
        Args: { p_currency: string; p_market_id: string };
        Returns: boolean;
      };
      is_org_admin: { Args: { p_org: string }; Returns: boolean };
      is_org_member: { Args: { p_org: string }; Returns: boolean };
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_safe_url_path: { Args: { p_path: string }; Returns: boolean };
      is_sales_agent: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_secret_reference: { Args: { p_value: string }; Returns: boolean };
      is_service_context: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_service_request: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_slug: { Args: { p_value: string }; Returns: boolean };
      is_subscription_item_due_for_period: {
        Args: {
          p_already_invoiced?: boolean;
          p_billing_anchor: string;
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_period_start: string;
          p_valid_to: string;
        };
        Returns: boolean;
      };
      is_super_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_tenant_app_active: {
        Args: { p_product_id: string; p_tenant_id: string };
        Returns: boolean;
      };
      is_valid_grant_value: { Args: { p_kind: string; p_value: Json }; Returns: boolean };
      is_valid_provisioning_base_url: {
        Args: { p_env: Database['platform']['Enums']['provisioning_environment']; p_url: string };
        Returns: boolean;
      };
      issue_entitlement_snapshot: {
        Args: { p_effective_at?: string; p_product_id: string; p_tenant_id: string };
        Returns: Json;
      };
      issue_partner_fee_statement: { Args: { p_statement_id: string }; Returns: Json };
      issue_subscription_invoice: {
        Args: { p_period_start?: string; p_subscription_id: string };
        Returns: Json;
      };
      jcs_canonical: { Args: { p_value: Json }; Returns: string };
      jsonb_deep_merge: { Args: { a: Json; b: Json }; Returns: Json };
      link_user_sales_agent: {
        Args: { p_reason?: string; p_sales_agent_id: string; p_user_id: string };
        Returns: string;
      };
      log_audit: {
        Args: {
          p_action: string;
          p_entity_id?: string;
          p_entity_type: string;
          p_metadata?: Json;
          p_organization_id?: string;
          p_tenant_id?: string;
        };
        Returns: number;
      };
      log_entitlement_sync_attempt: {
        Args: {
          p_detail: Json;
          p_operation: string;
          p_outcome: string;
          p_product_id: string;
          p_state_after: string;
          p_state_before: string;
          p_tenant_id: string;
          p_version: number;
          p_worker: string;
        };
        Returns: undefined;
      };
      log_provisioning_config_change: {
        Args: {
          p_action: string;
          p_after: Json;
          p_before: Json;
          p_entity_id: string;
          p_entity_type: string;
          p_product_id?: string;
        };
        Returns: number;
      };
      mark_entitlements_dirty: {
        Args: { p_product_id: string; p_reason: string; p_tenant_id: string };
        Returns: undefined;
      };
      mark_entitlements_dirty_for_source: {
        Args: { p_catalog_item_id: string; p_plan_id: string; p_reason: string };
        Returns: number;
      };
      market_id_by_code: { Args: { p_code: string }; Returns: string };
      mask_email: { Args: { p_email: string }; Returns: string };
      materialize_tenant_features: { Args: { p_tenant_id: string }; Returns: number };
      my_attributed_org_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      my_attributed_tenant_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      my_direct_tenant_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      my_org_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      my_provisioning_actor_role: { Args: Record<PropertyKey, never>; Returns: string };
      my_provisioning_permissions: { Args: Record<PropertyKey, never>; Returns: Json };
      my_provisioning_product_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      my_sales_agent_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      my_tenant_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      next_renewal_date: {
        Args: {
          p_as_of?: string;
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_ends_on: string;
          p_started_on: string;
        };
        Returns: string;
      };
      onboard_customer_subscription: {
        Args: {
          p_activate?: boolean;
          p_admin_email: string;
          p_attribution_pct?: number;
          p_attribution_source?: Database['platform']['Enums']['attribution_source'];
          p_billing_interval?: Database['platform']['Enums']['billing_interval'];
          p_channel_margin_rate?: number;
          p_commission_plan_id?: string;
          p_company_id?: string;
          p_currency?: string;
          p_customer_organization_id: string;
          p_deployment_mode?: Database['platform']['Enums']['deployment_mode'];
          p_deployment_target_id?: string;
          p_implementation_fee?: number;
          p_infrastructure_fee?: number;
          p_license_amount?: number;
          p_managing_organization_id?: string;
          p_market_code: string;
          p_notes?: string;
          p_plan_id: string;
          p_provisioning_mode?: string;
          p_quantity?: number;
          p_saas_product_code: string;
          p_sales_agent_id?: string;
          p_started_on?: string;
          p_support_fee?: number;
          p_tenant_name: string;
          p_tenant_slug: string;
          p_tenant_type?: Database['platform']['Enums']['tenant_type'];
        };
        Returns: Json;
      };
      open_ai_credit_period: {
        Args: { p_period_start: string; p_tenant_id: string };
        Returns: Json;
      };
      org_role_family: {
        Args: { p_role: Database['platform']['Enums']['org_role'] };
        Returns: string;
      };
      org_role_rank: {
        Args: { p_role: Database['platform']['Enums']['org_role'] };
        Returns: number;
      };
      partner_billing_channel_for: {
        Args: { p_at?: string; p_tenant_id: string };
        Returns: string;
      };
      partner_fee_lines: {
        Args: { p_partner_id: string; p_period_start: string };
        Returns: {
          agreement_id: string;
          base_list_amount: number;
          basis: Json;
          currency: string;
          fee_amount: number;
          fee_fixed_amount: number;
          fee_rate: number;
          line_kind: string;
          saas_product_id: string;
          subscription_id: string;
          tenant_id: string;
        }[];
      };
      payment_link_card_on_file: { Args: { p_organization_id: string }; Returns: Json };
      payment_link_charge_context: {
        Args: { p_invoice_id: string; p_token_hash: string };
        Returns: Json;
      };
      payment_link_enrollment: { Args: { p_link_id: string }; Returns: Json };
      payment_link_enrollment_context: { Args: { p_token_hash: string }; Returns: Json };
      payment_link_error: {
        Args: { p_link: Database['platform']['Tables']['payment_links']['Row'] };
        Returns: string;
      };
      payment_link_lookup: {
        Args: { p_token_hash: string };
        Returns: {
          access_count: number;
          allow_card_enrollment: boolean;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          last_accessed_at: string | null;
          organization_id: string;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          token_hash: string;
          token_hint: string;
        };
        SetofOptions: {
          from: '*';
          to: 'payment_links';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      payment_link_statement: {
        Args: { p_client_fingerprint?: string; p_token_hash: string };
        Returns: Json;
      };
      payment_provider_account_secret: { Args: { p_account_id: string }; Returns: string };
      plan_has_regional_price: {
        Args: { p_as_of?: string; p_currency: string; p_market_id: string; p_plan_id: string };
        Returns: boolean;
      };
      provider_account_candidates: {
        Args: {
          p_collection_method: Database['platform']['Enums']['collection_method'];
          p_subscription_id: string;
        };
        Returns: {
          account_code: string;
          account_name: string;
          currencies: string[];
          eligible: boolean;
          environment: Database['platform']['Enums']['provider_environment'];
          market_code: string;
          owner_organization_id: string;
          provider_account_id: string;
          provider_kind: Database['platform']['Enums']['provider_kind'];
          reason: string;
          route_rank: number;
        }[];
      };
      provider_kind_supports_method: {
        Args: {
          p_kind: Database['platform']['Enums']['provider_kind'];
          p_method: Database['platform']['Enums']['collection_method'];
        };
        Returns: boolean;
      };
      provisioning_execution_context: { Args: { p_request_id: string }; Returns: Json };
      purchase_ai_credits: {
        Args: {
          p_catalog_item_code: string;
          p_idempotency_key: string;
          p_packs: number;
          p_period_start: string;
          p_pool_key: string;
          p_reason: string;
          p_subscription_id: string;
        };
        Returns: Json;
      };
      reactivate_tenant_addon: {
        Args: { p_reason: string; p_tenant_addon_id: string };
        Returns: undefined;
      };
      reactivate_user: { Args: { p_reason?: string; p_user_id: string }; Returns: string };
      receivables_aging: {
        Args: { p_organization_id?: string };
        Returns: {
          aging_bucket: string;
          balance: number;
          currency: string;
          invoice_count: number;
        }[];
      };
      receive_commercial_document: {
        Args: {
          p_amount?: number;
          p_document_id: string;
          p_document_number: string;
          p_external_file_ref?: string;
          p_notes?: string;
          p_valid_from?: string;
          p_valid_to?: string;
        };
        Returns: undefined;
      };
      record_ai_credit_entry: {
        Args: {
          p_credits: number;
          p_entry_type: string;
          p_idempotency_key: string;
          p_period_start: string;
          p_pool_key: string;
          p_reason: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      record_billing_shadow_comparison: {
        Args: {
          p_actor: string;
          p_local: Json;
          p_period_start: string;
          p_saas_product_code: string;
          p_tenant_id: string;
        };
        Returns: Json;
      };
      record_entitlement_push_result: {
        Args: {
          p_outcome: Json;
          p_product_id: string;
          p_tenant_id: string;
          p_version: number;
          p_worker: string;
        };
        Returns: string;
      };
      record_entitlement_registry_check: {
        Args: { p_codes: string[]; p_manifest_version: string; p_product_id: string };
        Returns: boolean;
      };
      record_entitlement_verify_result: {
        Args: { p_observed: Json; p_product_id: string; p_tenant_id: string; p_worker: string };
        Returns: string;
      };
      record_invitation_resend: {
        Args: { p_delivery: string; p_user_id: string };
        Returns: string;
      };
      record_provisioning_event: {
        Args: {
          p_action: string;
          p_actor_id?: string;
          p_actor_role?: string;
          p_detail?: Json;
          p_http_status?: number;
          p_message: string;
          p_request_id: string;
        };
        Returns: number;
      };
      record_user_invitation: {
        Args: {
          p_delivery: string;
          p_email: string;
          p_full_name?: string;
          p_grant: Json;
          p_user_id: string;
        };
        Returns: string;
      };
      refresh_billing_alerts: { Args: { p_as_of?: string }; Returns: number };
      refresh_entitlement_gates_for_integration: {
        Args: { p_integration_id: string };
        Returns: number;
      };
      refresh_entitlement_sync_state: {
        Args: { p_product_id: string; p_tenant_id: string };
        Returns: string;
      };
      refresh_tenant_features: { Args: { p_tenant_id: string }; Returns: number };
      register_manual_provisioning: {
        Args: {
          p_external_company_id?: string;
          p_external_organization_id?: string;
          p_external_tenant_id: string;
          p_metadata?: Json;
          p_request_id: string;
        };
        Returns: string;
      };
      register_payment_link_event: {
        Args: {
          p_amount?: number;
          p_client_fingerprint?: string;
          p_currency?: string;
          p_error_code?: string;
          p_external_id?: string;
          p_invoice_id?: string;
          p_kind: string;
          p_link_id: string;
        };
        Returns: Json;
      };
      register_provider_invoice_payment: {
        Args: {
          p_amount: number;
          p_currency: string;
          p_external_charge_id: string;
          p_external_event_key: string;
          p_invoice_id: string;
          p_paid_at?: string;
          p_payload?: Json;
          p_provider_account_id: string;
        };
        Returns: Json;
      };
      register_provider_payment: {
        Args: {
          p_amount: number;
          p_currency: string;
          p_event_type: string;
          p_external_charge_id: string;
          p_external_event_key: string;
          p_external_subscription_id: string;
          p_paid_at?: string;
          p_payload?: Json;
          p_provider_account_id: string;
        };
        Returns: Json;
      };
      register_provider_payment_failure: {
        Args: {
          p_error_code?: string;
          p_error_message?: string;
          p_event_type: string;
          p_external_event_key: string;
          p_external_subscription_id: string;
          p_payload?: Json;
          p_provider_account_id: string;
        };
        Returns: Json;
      };
      register_provider_plan: {
        Args: {
          p_amount: number;
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_currency: string;
          p_external_plan_id: string;
          p_metadata?: Json;
          p_plan_id: string;
          p_provider_account_id: string;
        };
        Returns: Json;
      };
      reject_commercial_document: {
        Args: { p_document_id: string; p_reason: string };
        Returns: undefined;
      };
      reject_tenant_addon: {
        Args: { p_reason: string; p_tenant_addon_id: string };
        Returns: undefined;
      };
      release_ai_credit_reservation: { Args: { p_reservation_id: string }; Returns: string };
      release_invoice_charge_lock: {
        Args: { p_lock_id: string; p_outcome?: string; p_outcome_code?: string };
        Returns: Json;
      };
      reporting_settings: {
        Args: Record<PropertyKey, never>;
        Returns: {
          fx_max_rate_age_days: number;
          reporting_currency: string;
        }[];
      };
      request_commercial_document: {
        Args: {
          p_amount?: number;
          p_currency?: string;
          p_document_type: Database['platform']['Enums']['commercial_document_type'];
          p_notes?: string;
          p_subscription_id: string;
          p_valid_from?: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      request_tenant_addon: {
        Args: {
          p_addon_code: string;
          p_company_id?: string;
          p_reason?: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      request_tenant_resume: {
        Args: { p_mode?: string; p_reason?: string; p_tenant_id: string };
        Returns: Json;
      };
      request_tenant_suspension: {
        Args: { p_mode?: string; p_reason: string; p_tenant_id: string };
        Returns: Json;
      };
      require_active_market: {
        Args: { p_market_code: string };
        Returns: {
          code: string;
          country_code: string;
          created_at: string;
          default_currency_code: string;
          id: string;
          name: string;
          sort_order: number;
          status: Database['platform']['Enums']['entity_status'];
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'markets';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      require_deployment_target: {
        Args: {
          p_environment: Database['platform']['Enums']['provisioning_environment'];
          p_product_id: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      reserve_ai_credits: {
        Args: {
          p_credits: number;
          p_idempotency_key: string;
          p_period_start: string;
          p_pool_key: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      resolve_deployment_target: {
        Args: {
          p_environment: Database['platform']['Enums']['provisioning_environment'];
          p_product_id: string;
          p_tenant_id: string;
        };
        Returns: Json;
      };
      resolve_invoice_card_account: { Args: { p_invoice_id: string }; Returns: string };
      resolve_market_currency: {
        Args: { p_currency: string; p_market_id: string };
        Returns: string;
      };
      resolve_org_card_account: { Args: { p_organization_id: string }; Returns: string };
      resume_tenant_addon: {
        Args: { p_reason: string; p_tenant_addon_id: string };
        Returns: undefined;
      };
      retry_provisioning_request: { Args: { p_request_id: string }; Returns: string };
      retry_saas_provisioning_request: { Args: { p_request_id: string }; Returns: string };
      reveal_credential_secret_ref: { Args: { p_id: string }; Returns: Json };
      reverse_ai_credit_entry: { Args: { p_entry_id: string; p_reason: string }; Returns: string };
      reverse_payment: { Args: { p_payment_id: string; p_reason: string }; Returns: Json };
      revoke_card_on_file_authorization: {
        Args: { p_authorization_id: string; p_reason: string };
        Returns: Json;
      };
      revoke_card_on_file_internal: {
        Args: {
          p_actor: string;
          p_authorization_id: string;
          p_organization_id: string;
          p_reason: string;
          p_source: string;
        };
        Returns: number;
      };
      revoke_entitlement_override: {
        Args: { p_override_id: string; p_reason: string };
        Returns: undefined;
      };
      revoke_payment_link: { Args: { p_link_id: string; p_reason: string }; Returns: Json };
      revoke_platform_role: { Args: { p_reason: string; p_user_id: string }; Returns: string };
      revoke_provisioning_role: { Args: { p_id: string }; Returns: string };
      schedule_cancel_tenant_addon: {
        Args: { p_effective_to?: string; p_reason: string; p_tenant_addon_id: string };
        Returns: string;
      };
      schedule_corrective_discount: {
        Args: { p_amount: number; p_invoice_line_id: string; p_reason: string };
        Returns: Json;
      };
      set_agreement_platform_fee: {
        Args: {
          p_agreement_id: string;
          p_currency?: string;
          p_fixed_amount?: number;
          p_model: string;
          p_rate?: number;
          p_reason?: string;
        };
        Returns: Json;
      };
      set_ai_credit_weight: {
        Args: {
          p_capability_code: string;
          p_credits_per_unit: number;
          p_reason: string;
          p_unit: string;
          p_valid_from: string;
        };
        Returns: string;
      };
      set_billing_alert_status: {
        Args: {
          p_alert_id: string;
          p_note?: string;
          p_status: Database['platform']['Enums']['billing_alert_status'];
        };
        Returns: undefined;
      };
      set_billing_contact: {
        Args: {
          p_address: string;
          p_city: string;
          p_email: string;
          p_first_name: string;
          p_last_name: string;
          p_organization_id: string;
          p_phone: string;
        };
        Returns: string;
      };
      set_billing_contact_from_portal: {
        Args: {
          p_address: string;
          p_city: string;
          p_email: string;
          p_first_name: string;
          p_last_name: string;
          p_link_id: string;
          p_phone: string;
        };
        Returns: Json;
      };
      set_catalog_item_credit_pack: {
        Args: { p_catalog_item_code: string; p_credits: number; p_reason: string };
        Returns: Json;
      };
      set_catalog_item_lifecycle: {
        Args: { p_code: string; p_reason: string; p_status: string };
        Returns: undefined;
      };
      set_catalog_item_price: {
        Args: {
          p_amount: number;
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_catalog_item_code: string;
          p_charge_kind: Database['platform']['Enums']['charge_kind'];
          p_currency: string;
          p_market_code: string;
          p_valid_from?: string;
        };
        Returns: string;
      };
      set_catalog_item_usage_binding: {
        Args: {
          p_catalog_item_code: string;
          p_meter_code: string;
          p_reason: string;
          p_source: string;
        };
        Returns: Json;
      };
      set_commercial_cutover_state: {
        Args: { p_axis: string; p_integration_id: string; p_reason: string; p_to_state: string };
        Returns: string;
      };
      set_deployment_health: {
        Args: {
          p_deployment_target_id: string;
          p_detail?: string;
          p_health: Database['platform']['Enums']['deployment_health'];
        };
        Returns: Database['platform']['Enums']['deployment_health'];
      };
      set_entitlements_push_enabled: {
        Args: { p_enabled: boolean; p_integration_id: string; p_reason: string };
        Returns: boolean;
      };
      set_exchange_rate: {
        Args: {
          p_base: string;
          p_is_demo?: boolean;
          p_notes?: string;
          p_quote: string;
          p_rate: number;
          p_rate_date: string;
          p_source?: Database['platform']['Enums']['fx_rate_source'];
        };
        Returns: string;
      };
      set_organization_membership_active: {
        Args: { p_active: boolean; p_membership_id: string; p_reason?: string };
        Returns: string;
      };
      set_payment_provider_api_base: {
        Args: { p_account_id: string; p_api_base_url: string };
        Returns: Json;
      };
      set_payment_provider_secret: {
        Args: { p_account_id: string; p_reason?: string; p_secret: string };
        Returns: Json;
      };
      set_plan_price: {
        Args: {
          p_amount: number;
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_charge_kind: Database['platform']['Enums']['charge_kind'];
          p_currency: string;
          p_market_code: string;
          p_plan_id: string;
          p_valid_from?: string;
        };
        Returns: string;
      };
      set_reporting_settings: {
        Args: { p_fx_max_rate_age_days?: number; p_reporting_currency: string };
        Returns: undefined;
      };
      set_saas_provisioning_configuration: {
        Args: { p_configuration: Json; p_request_id: string };
        Returns: Json;
      };
      set_subscription_billing_channel: {
        Args: { p_channel: string; p_reason: string; p_subscription_id: string };
        Returns: Json;
      };
      set_subscription_collection_profile: {
        Args: {
          p_auto_charge?: boolean;
          p_auto_suspend?: boolean;
          p_collection_method: Database['platform']['Enums']['collection_method'];
          p_currency?: string;
          p_document_lead_days?: number;
          p_effective_from?: string;
          p_grace_period_days?: number;
          p_invoice_lead_days?: number;
          p_notes?: string;
          p_payment_due_days?: number;
          p_provider_account_id?: string;
          p_renewal_notice_days?: number;
          p_requires_purchase_order?: boolean;
          p_requires_service_order?: boolean;
          p_route_provider?: boolean;
          p_status?: Database['platform']['Enums']['collection_profile_status'];
          p_subscription_id: string;
        };
        Returns: string;
      };
      set_subscription_status: {
        Args: {
          p_reason?: string;
          p_status: Database['platform']['Enums']['subscription_status'];
          p_subscription_id: string;
        };
        Returns: undefined;
      };
      set_tenant_feature: {
        Args: { p_enabled: boolean; p_feature_key: string; p_tenant_id: string; p_value?: Json };
        Returns: undefined;
      };
      set_tenant_membership_active: {
        Args: { p_active: boolean; p_membership_id: string; p_reason?: string };
        Returns: string;
      };
      set_tenant_status: {
        Args: {
          p_reason?: string;
          p_status: Database['platform']['Enums']['tenant_status'];
          p_tenant_id: string;
        };
        Returns: undefined;
      };
      set_usage_ingest_enabled: {
        Args: { p_enabled: boolean; p_product_code: string; p_reason: string };
        Returns: number;
      };
      set_usage_meter_billable: {
        Args: { p_billable: boolean; p_code: string; p_product_code: string; p_reason: string };
        Returns: undefined;
      };
      settle_commissions: {
        Args: {
          p_currency: string;
          p_period_end: string;
          p_period_start: string;
          p_sales_agent_id: string;
        };
        Returns: string;
      };
      signed_line_amount: {
        Args: { p_amount: number; p_charge_kind: Database['platform']['Enums']['charge_kind'] };
        Returns: number;
      };
      subscription_due_items: {
        Args: { p_period_start: string; p_subscription_id: string };
        Returns: {
          amount: number;
          billing_anchor: string;
          billing_interval: Database['platform']['Enums']['billing_interval'];
          charge_kind: Database['platform']['Enums']['charge_kind'];
          currency: string;
          description: string;
          quantity: number;
          subscription_item_id: string;
          tenant_id: string;
          unit_amount: number;
          valid_to: string;
        }[];
      };
      subscription_usage_lines: {
        Args: { p_period_start: string; p_subscription_id: string };
        Returns: Json;
      };
      suspend_tenant_addon: {
        Args: { p_reason: string; p_tenant_addon_id: string };
        Returns: undefined;
      };
      switch_profile_to_card_on_file: {
        Args: {
          p_account_id: string;
          p_note: string;
          p_payment_method_id: string;
          p_subscription_id: string;
        };
        Returns: string;
      };
      to_reporting_amount: {
        Args: {
          p_amount: number;
          p_as_of: string;
          p_currency: string;
          p_max_age_days?: number;
          p_reporting_currency?: string;
        };
        Returns: {
          conversion_status: string;
          fx_is_demo: boolean;
          fx_method: string;
          fx_rate: number;
          fx_rate_date: string;
          fx_rate_id: string;
          native_amount: number;
          native_currency: string;
          reporting_amount: number;
          reporting_currency: string;
        }[];
      };
      transition_tenant_addon: {
        Args: {
          p_action: string;
          p_from: string[];
          p_patch?: Json;
          p_reason: string;
          p_tenant_addon_id: string;
          p_to: string;
        };
        Returns: {
          activated_at: string;
          active: boolean;
          addon_code: string;
          approved_at: string | null;
          approved_by: string | null;
          company_id: string | null;
          created_at: string;
          effective_from: string | null;
          effective_to: string | null;
          id: string;
          request_source: string;
          requested_at: string;
          requested_by: string | null;
          status: string;
          status_reason: string | null;
          subscription_item_id: string | null;
          tenant_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'tenant_addons';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      unenroll_card_on_file: {
        Args: { p_client_fingerprint?: string; p_token_hash: string };
        Returns: Json;
      };
      update_tenant: {
        Args: {
          p_accent_color?: string;
          p_admin_email?: string;
          p_logo_url?: string;
          p_metadata?: Json;
          p_name: string;
          p_tenant_id: string;
          p_white_label?: boolean;
        };
        Returns: undefined;
      };
      upsert_capability_alias: {
        Args: {
          p_alias_code: string;
          p_alias_source: string;
          p_capability_code: string;
          p_product_code: string;
        };
        Returns: string;
      };
      upsert_catalog_item: {
        Args: {
          p_available?: boolean;
          p_code: string;
          p_currency?: string;
          p_description?: string;
          p_id?: string;
          p_item_type?: string;
          p_name: string;
          p_price_month?: number;
          p_saas_product_id?: string;
          p_scope?: string;
        };
        Returns: string;
      };
      upsert_commission_plan: {
        Args: {
          p_code: string;
          p_description?: string;
          p_id?: string;
          p_name: string;
          p_saas_product_id?: string;
          p_status?: Database['platform']['Enums']['entity_status'];
          p_valid_from?: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      upsert_commission_rule: {
        Args: {
          p_basis: Database['platform']['Enums']['commission_basis'];
          p_charge_kind?: Database['platform']['Enums']['charge_kind'];
          p_commission_plan_id: string;
          p_currency?: string;
          p_fixed_amount?: number;
          p_id?: string;
          p_is_recurring?: boolean;
          p_max_months?: number;
          p_max_total_amount?: number;
          p_name: string;
          p_priority?: number;
          p_rate?: number;
          p_status?: Database['platform']['Enums']['entity_status'];
          p_valid_from?: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      upsert_company: {
        Args: {
          p_country_code?: string;
          p_currency?: string;
          p_erp_code?: string;
          p_id?: string;
          p_is_default?: boolean;
          p_market_code?: string;
          p_name: string;
          p_organization_id: string;
          p_status?: Database['platform']['Enums']['entity_status'];
          p_tax_id?: string;
        };
        Returns: string;
      };
      upsert_credential_profile: {
        Args: {
          p_algorithm?: Database['platform']['Enums']['m2m_algorithm'];
          p_audience?: string;
          p_code: string;
          p_enabled?: boolean;
          p_environment: Database['platform']['Enums']['provisioning_environment'];
          p_id?: string;
          p_issuer?: string;
          p_name: string;
          p_public_key_ref?: string;
          p_saas_product_id?: string;
          p_secret_ref?: string;
          p_token_ttl_seconds?: number;
          p_type: Database['platform']['Enums']['credential_profile_type'];
        };
        Returns: string;
      };
      upsert_currency: {
        Args: {
          p_code: string;
          p_decimals: number;
          p_name: string;
          p_status?: Database['platform']['Enums']['entity_status'];
          p_symbol?: string;
        };
        Returns: string;
      };
      upsert_deployment_target: {
        Args: {
          p_code: string;
          p_cost_center?: string;
          p_deployment_mode: Database['platform']['Enums']['deployment_mode'];
          p_environment?: Database['platform']['Enums']['environment_kind'];
          p_id?: string;
          p_metadata?: Json;
          p_name: string;
          p_owner_organization_id?: string;
          p_provider: Database['platform']['Enums']['infra_provider'];
          p_provider_project_ref?: string;
          p_region?: string;
          p_saas_product_id?: string;
          p_status?: Database['platform']['Enums']['entity_status'];
        };
        Returns: string;
      };
      upsert_market: {
        Args: {
          p_allowed_currency_codes: string[];
          p_code: string;
          p_country_code: string;
          p_default_currency_code: string;
          p_name: string;
          p_sort_order?: number;
          p_status?: Database['platform']['Enums']['entity_status'];
        };
        Returns: string;
      };
      upsert_organization: {
        Args: {
          p_accent_color?: string;
          p_billing_email?: string;
          p_brand_slug?: string;
          p_capabilities?: Database['platform']['Enums']['org_capability'][];
          p_country_code?: string;
          p_display_name: string;
          p_id?: string;
          p_legal_name: string;
          p_logo_url?: string;
          p_metadata?: Json;
          p_slug: string;
          p_status?: Database['platform']['Enums']['entity_status'];
          p_tax_id?: string;
          p_white_label?: boolean;
        };
        Returns: string;
      };
      upsert_organization_membership: {
        Args: {
          p_company_id?: string;
          p_org_id: string;
          p_reason?: string;
          p_role: Database['platform']['Enums']['org_role'];
          p_user_id: string;
        };
        Returns: string;
      };
      upsert_payment_provider_account: {
        Args: {
          p_code: string;
          p_currencies?: string[];
          p_environment?: Database['platform']['Enums']['provider_environment'];
          p_id?: string;
          p_market_code?: string;
          p_metadata?: Json;
          p_name: string;
          p_owner_organization_id?: string;
          p_provider_kind: Database['platform']['Enums']['provider_kind'];
          p_public_key?: string;
          p_routing_priority?: number;
          p_rsa_id_ref?: string;
          p_rsa_public_key_ref?: string;
          p_secret_key_ref?: string;
          p_status?: Database['platform']['Enums']['entity_status'];
          p_webhook_endpoint?: string;
        };
        Returns: string;
      };
      upsert_plan: {
        Args: {
          p_code: string;
          p_deployment_mode?: Database['platform']['Enums']['deployment_mode'];
          p_description?: string;
          p_id?: string;
          p_included_companies?: number;
          p_is_partner_base?: boolean;
          p_metadata?: Json;
          p_multi_country?: boolean;
          p_name: string;
          p_saas_product_id: string;
          p_sort_order?: number;
          p_status?: Database['platform']['Enums']['entity_status'];
        };
        Returns: string;
      };
      upsert_product_agreement: {
        Args: {
          p_allowed_deployment_modes?: Database['platform']['Enums']['deployment_mode'][];
          p_allowed_tenant_types?: Database['platform']['Enums']['tenant_type'][];
          p_billing_responsibility?: Database['platform']['Enums']['billing_responsibility'];
          p_can_manage_tenants?: boolean;
          p_can_resell?: boolean;
          p_default_deployment_mode?: Database['platform']['Enums']['deployment_mode'];
          p_id?: string;
          p_margin_rate?: number;
          p_max_tenants?: number;
          p_notes?: string;
          p_organization_id: string;
          p_saas_product_id: string;
          p_status?: Database['platform']['Enums']['entity_status'];
          p_terms?: Json;
          p_valid_from?: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      upsert_product_integration: {
        Args: {
          p_adapter_key?: Database['platform']['Enums']['integration_adapter'];
          p_additional_scopes?: string[];
          p_algorithm?: Database['platform']['Enums']['m2m_algorithm'];
          p_allowed_hosts?: string[];
          p_audience?: string;
          p_code: string;
          p_contract_version?: string;
          p_create_path_template?: string;
          p_create_scope?: string;
          p_enabled?: boolean;
          p_health_path_template?: string;
          p_id?: string;
          p_integration_type: Database['platform']['Enums']['integration_type'];
          p_issuer?: string;
          p_metadata?: Json;
          p_name: string;
          p_owner_name?: string;
          p_owner_user_id?: string;
          p_provisioning_policy?: Database['platform']['Enums']['provisioning_policy'];
          p_read_scope?: string;
          p_saas_product_id: string;
          p_status?: Database['platform']['Enums']['integration_status'];
          p_status_path_template?: string;
          p_subject?: string;
          p_token_ttl_seconds?: number;
        };
        Returns: string;
      };
      upsert_product_owner: {
        Args: {
          p_environment_scope?: Database['platform']['Enums']['provisioning_environment'][];
          p_is_active?: boolean;
          p_role?: Database['platform']['Enums']['product_owner_role'];
          p_saas_product_id: string;
          p_user_id: string;
        };
        Returns: string;
      };
      upsert_provider_subscription: {
        Args: {
          p_external_customer_id?: string;
          p_external_payment_method_id?: string;
          p_external_plan_id?: string;
          p_external_subscription_id: string;
          p_metadata?: Json;
          p_next_billing_at?: string;
          p_provider_account_id: string;
          p_provider_status?: string;
          p_subscription_id: string;
        };
        Returns: string;
      };
      upsert_saas_product: {
        Args: {
          p_accent_color?: string;
          p_billing_unit?: string;
          p_code: string;
          p_description?: string;
          p_id?: string;
          p_is_billable?: boolean;
          p_metadata?: Json;
          p_name: string;
          p_short_name: string;
          p_sort_order?: number;
          p_status?: Database['platform']['Enums']['entity_status'];
        };
        Returns: string;
      };
      upsert_sales_agent: {
        Args: {
          p_agent_type?: Database['platform']['Enums']['sales_agent_type'];
          p_code: string;
          p_contact_email?: string;
          p_full_name: string;
          p_id?: string;
          p_metadata?: Json;
          p_organization_id?: string;
          p_status?: Database['platform']['Enums']['entity_status'];
          p_user_id?: string;
          p_valid_from?: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      upsert_subscription_item: {
        Args: {
          p_billing_interval: Database['platform']['Enums']['billing_interval'];
          p_catalog_item_code?: string;
          p_charge_kind: Database['platform']['Enums']['charge_kind'];
          p_currency?: string;
          p_description: string;
          p_id?: string;
          p_quantity: number;
          p_subscription_id: string;
          p_tenant_id?: string;
          p_unit_amount: number;
          p_valid_from?: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      upsert_tenant_membership: {
        Args: {
          p_reason?: string;
          p_role: Database['platform']['Enums']['tenant_role'];
          p_tenant_id: string;
          p_user_id: string;
        };
        Returns: string;
      };
      upsert_usage_meter: {
        Args: {
          p_aggregation: string;
          p_allows_negative?: boolean;
          p_capability_code?: string;
          p_code: string;
          p_grace_hours?: number;
          p_measurement?: string;
          p_name: string;
          p_product_code: string;
          p_status: string;
          p_unit: string;
        };
        Returns: string;
      };
      url_authority: { Args: { p_url: string }; Returns: string };
      url_host: { Args: { p_url: string }; Returns: string };
      url_scheme: { Args: { p_url: string }; Returns: string };
      usage_assign_period: {
        Args: { p_meter_id: string; p_occurred_at: string; p_tenant_id: string };
        Returns: Record<string, unknown>;
      };
      usage_billing_alert_once: {
        Args: {
          p_aggregate_id: string;
          p_code: string;
          p_detail: Json;
          p_product_id: string;
          p_tenant_id: string;
        };
        Returns: undefined;
      };
      usage_event_cogs: {
        Args: { p_from: string; p_tenant_id: string; p_to: string };
        Returns: {
          event_id: string;
          internal: Json;
          meter_code: string;
          occurred_at: string;
          quantity: number;
        }[];
      };
      usage_event_hash: {
        Args: {
          p_capability_code: string;
          p_event_id: string;
          p_external_company_id: string;
          p_internal: Json;
          p_meter_code: string;
          p_occurred_at: string;
          p_quantity: number;
          p_subject_ref: string;
          p_tenant_id: string;
          p_unit: string;
        };
        Returns: string;
      };
      usage_finalize_core: { Args: { p_actor: string; p_id: string }; Returns: Json };
      usage_ingest_credential: {
        Args: { p_issuer: string };
        Returns: {
          algorithm: string;
          audience: string;
          credential_enabled: boolean;
          environment: string;
          kid: string;
          product_code: string;
          product_ingest_enabled: boolean;
          public_key_ref: string;
        }[];
      };
      usage_internal_is_valid: { Args: { p_internal: Json }; Returns: boolean };
      void_exchange_rate: { Args: { p_rate_id: string; p_reason: string }; Returns: undefined };
      void_partner_fee_statement: {
        Args: { p_reason: string; p_statement_id: string };
        Returns: Json;
      };
    };
    Enums: {
      attribution_source: 'DIRECT' | 'PARTNER' | 'REFERRAL' | 'INBOUND' | 'CAMPAIGN';
      billing_alert_status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'CANCELLED';
      billing_alert_type:
        | 'REQUEST_DOCUMENT'
        | 'RENEWAL_NOTICE'
        | 'PAYMENT_DUE'
        | 'PAST_DUE'
        | 'GRACE_ENDING'
        | 'SUSPENSION_DUE'
        | 'PAYMENT_FAILURE'
        | 'DOCUMENT_EXPIRING';
      billing_interval: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONE_TIME';
      billing_responsibility: 'EBIM' | 'PARTNER' | 'MIXED';
      charge_kind:
        | 'LICENSE'
        | 'PARTNER_BASE_LICENSE'
        | 'TENANT_LICENSE'
        | 'IMPLEMENTATION_FEE'
        | 'INFRASTRUCTURE_FEE'
        | 'SUPPORT_FEE'
        | 'ADDON'
        | 'PROFESSIONAL_SERVICES'
        | 'DISCOUNT'
        | 'USAGE_OVERAGE'
        | 'CREDIT_PURCHASE'
        | 'PARTNER_PLATFORM_FEE';
      collection_method:
        'CULQI_CARD' | 'SERVICE_ORDER' | 'PURCHASE_ORDER' | 'BANK_TRANSFER' | 'MANUAL';
      collection_profile_status: 'ACTIVE' | 'INACTIVE' | 'PENDING_SETUP';
      commercial_document_status:
        'REQUESTED' | 'RECEIVED' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
      commercial_document_type: 'SERVICE_ORDER' | 'PURCHASE_ORDER';
      commission_basis:
        'COLLECTED_LICENSE' | 'COLLECTED_IMPLEMENTATION' | 'COLLECTED_ANY' | 'FIXED_AMOUNT';
      commission_status: 'PENDING' | 'ELIGIBLE' | 'ACCRUED' | 'PAID' | 'VOID';
      cost_category:
        | 'DATABASE'
        | 'COMPUTE'
        | 'STORAGE'
        | 'BANDWIDTH'
        | 'MESSAGING'
        | 'FRONTEND_HOSTING'
        | 'DOMAIN'
        | 'SUPPORT'
        | 'DEDICATED_INFRA'
        | 'THIRD_PARTY'
        | 'ADMIN_MANUAL';
      cost_scope: 'PLATFORM' | 'PRODUCT' | 'ORGANIZATION' | 'TENANT' | 'DEPLOYMENT_TARGET';
      credential_profile_type: 'M2M_ASYMMETRIC_JWT' | 'NONE';
      deployment_health: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
      deployment_mode: 'SHARED' | 'PARTNER_DEDICATED' | 'TENANT_DEDICATED';
      deployment_target_status: 'DRAFT' | 'READY' | 'MAINTENANCE' | 'DISABLED';
      entity_status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';
      environment_kind: 'DEMO' | 'TRIAL' | 'PRODUCTION' | 'SANDBOX';
      fx_rate_source: 'MANUAL';
      fx_rate_status: 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';
      infra_provider: 'SUPABASE' | 'AWS' | 'AZURE' | 'GCP' | 'ON_PREMISE';
      integration_adapter: 'GENERIC' | 'EWM_V1';
      integration_status: 'DRAFT' | 'READY' | 'DEGRADED' | 'DISABLED';
      integration_type: 'HTTP_M2M' | 'EDGE_FUNCTION' | 'MANUAL' | 'MOCK';
      invoice_status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
      m2m_algorithm: 'RS256' | 'ES256';
      org_capability: 'PARTNER' | 'RESELLER' | 'CONSULTING' | 'CUSTOMER';
      org_kind: 'PLATFORM' | 'COMPANY';
      org_relationship_type: 'MANAGES' | 'RESELLS_TO' | 'SUBCONTRACTS';
      org_role: 'PARTNER_ADMIN' | 'PARTNER_SALES' | 'PARTNER_SUPPORT' | 'ORG_ADMIN' | 'ORG_VIEWER';
      payment_status: 'PENDING' | 'CONFIRMED' | 'REVERSED';
      platform_role: 'EBIM_SUPER_ADMIN' | 'EBIM_PRODUCT_ADMIN' | 'EBIM_FINANCE';
      product_owner_role: 'TECHNICAL_OWNER' | 'BACKUP_OWNER' | 'VIEWER';
      provider_environment: 'TEST' | 'LIVE';
      provider_kind: 'CULQI' | 'MANUAL' | 'BANK' | 'OTHER';
      provider_mapping_status: 'ACTIVE' | 'INACTIVE' | 'FAILED' | 'PENDING';
      provisioning_action:
        | 'CREATE_TENANT_SPACE'
        | 'CREATE_DEDICATED_TARGET'
        | 'ATTACH_TENANT_TO_TARGET'
        | 'SUSPEND_TENANT'
        | 'RESUME_TENANT'
        | 'DECOMMISSION_TENANT';
      provisioning_environment: 'DEV' | 'QAS' | 'DEMO' | 'PRD';
      provisioning_policy: 'MANUAL' | 'AFTER_SUBSCRIPTION_ACTIVE' | 'AFTER_PAYMENT_CONFIRMED';
      provisioning_role:
        'TECH_LEAD' | 'PROVISIONING_ADMIN' | 'PRODUCT_OWNER' | 'PROVISIONING_VIEWER';
      provisioning_status:
        'PENDING' | 'VALIDATING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
      saas_provisioning_status:
        | 'PENDING'
        | 'WAITING_INFRA'
        | 'READY_TO_PROVISION'
        | 'PROVISIONING'
        | 'ACTIVE'
        | 'FAILED'
        | 'CANCELLED';
      sales_agent_type: 'EBIM_INTERNAL' | 'INDEPENDENT' | 'PARTNER_AGENT';
      settlement_status: 'OPEN' | 'APPROVED' | 'PAID' | 'CANCELLED';
      subscription_status: 'DRAFT' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELLED';
      tenant_product_mapping_status: 'PENDING' | 'ACTIVE' | 'FAILED' | 'SUSPENDED';
      tenant_role: 'TENANT_ADMIN' | 'TENANT_USER';
      tenant_status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CHURNED' | 'ARCHIVED';
      tenant_type: 'DEMO' | 'TRIAL' | 'PRODUCTION' | 'SANDBOX';
      webhook_event_status: 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'REJECTED';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  platform: {
    Enums: {
      attribution_source: ['DIRECT', 'PARTNER', 'REFERRAL', 'INBOUND', 'CAMPAIGN'],
      billing_alert_status: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'],
      billing_alert_type: [
        'REQUEST_DOCUMENT',
        'RENEWAL_NOTICE',
        'PAYMENT_DUE',
        'PAST_DUE',
        'GRACE_ENDING',
        'SUSPENSION_DUE',
        'PAYMENT_FAILURE',
        'DOCUMENT_EXPIRING',
      ],
      billing_interval: ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME'],
      billing_responsibility: ['EBIM', 'PARTNER', 'MIXED'],
      charge_kind: [
        'LICENSE',
        'PARTNER_BASE_LICENSE',
        'TENANT_LICENSE',
        'IMPLEMENTATION_FEE',
        'INFRASTRUCTURE_FEE',
        'SUPPORT_FEE',
        'ADDON',
        'PROFESSIONAL_SERVICES',
        'DISCOUNT',
        'USAGE_OVERAGE',
        'CREDIT_PURCHASE',
        'PARTNER_PLATFORM_FEE',
      ],
      collection_method: [
        'CULQI_CARD',
        'SERVICE_ORDER',
        'PURCHASE_ORDER',
        'BANK_TRANSFER',
        'MANUAL',
      ],
      collection_profile_status: ['ACTIVE', 'INACTIVE', 'PENDING_SETUP'],
      commercial_document_status: [
        'REQUESTED',
        'RECEIVED',
        'APPROVED',
        'REJECTED',
        'EXPIRED',
        'CANCELLED',
      ],
      commercial_document_type: ['SERVICE_ORDER', 'PURCHASE_ORDER'],
      commission_basis: [
        'COLLECTED_LICENSE',
        'COLLECTED_IMPLEMENTATION',
        'COLLECTED_ANY',
        'FIXED_AMOUNT',
      ],
      commission_status: ['PENDING', 'ELIGIBLE', 'ACCRUED', 'PAID', 'VOID'],
      cost_category: [
        'DATABASE',
        'COMPUTE',
        'STORAGE',
        'BANDWIDTH',
        'MESSAGING',
        'FRONTEND_HOSTING',
        'DOMAIN',
        'SUPPORT',
        'DEDICATED_INFRA',
        'THIRD_PARTY',
        'ADMIN_MANUAL',
      ],
      cost_scope: ['PLATFORM', 'PRODUCT', 'ORGANIZATION', 'TENANT', 'DEPLOYMENT_TARGET'],
      credential_profile_type: ['M2M_ASYMMETRIC_JWT', 'NONE'],
      deployment_health: ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY'],
      deployment_mode: ['SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED'],
      deployment_target_status: ['DRAFT', 'READY', 'MAINTENANCE', 'DISABLED'],
      entity_status: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED'],
      environment_kind: ['DEMO', 'TRIAL', 'PRODUCTION', 'SANDBOX'],
      fx_rate_source: ['MANUAL'],
      fx_rate_status: ['ACTIVE', 'SUPERSEDED', 'VOIDED'],
      infra_provider: ['SUPABASE', 'AWS', 'AZURE', 'GCP', 'ON_PREMISE'],
      integration_adapter: ['GENERIC', 'EWM_V1'],
      integration_status: ['DRAFT', 'READY', 'DEGRADED', 'DISABLED'],
      integration_type: ['HTTP_M2M', 'EDGE_FUNCTION', 'MANUAL', 'MOCK'],
      invoice_status: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID', 'UNCOLLECTIBLE'],
      m2m_algorithm: ['RS256', 'ES256'],
      org_capability: ['PARTNER', 'RESELLER', 'CONSULTING', 'CUSTOMER'],
      org_kind: ['PLATFORM', 'COMPANY'],
      org_relationship_type: ['MANAGES', 'RESELLS_TO', 'SUBCONTRACTS'],
      org_role: ['PARTNER_ADMIN', 'PARTNER_SALES', 'PARTNER_SUPPORT', 'ORG_ADMIN', 'ORG_VIEWER'],
      payment_status: ['PENDING', 'CONFIRMED', 'REVERSED'],
      platform_role: ['EBIM_SUPER_ADMIN', 'EBIM_PRODUCT_ADMIN', 'EBIM_FINANCE'],
      product_owner_role: ['TECHNICAL_OWNER', 'BACKUP_OWNER', 'VIEWER'],
      provider_environment: ['TEST', 'LIVE'],
      provider_kind: ['CULQI', 'MANUAL', 'BANK', 'OTHER'],
      provider_mapping_status: ['ACTIVE', 'INACTIVE', 'FAILED', 'PENDING'],
      provisioning_action: [
        'CREATE_TENANT_SPACE',
        'CREATE_DEDICATED_TARGET',
        'ATTACH_TENANT_TO_TARGET',
        'SUSPEND_TENANT',
        'RESUME_TENANT',
        'DECOMMISSION_TENANT',
      ],
      provisioning_environment: ['DEV', 'QAS', 'DEMO', 'PRD'],
      provisioning_policy: ['MANUAL', 'AFTER_SUBSCRIPTION_ACTIVE', 'AFTER_PAYMENT_CONFIRMED'],
      provisioning_role: [
        'TECH_LEAD',
        'PROVISIONING_ADMIN',
        'PRODUCT_OWNER',
        'PROVISIONING_VIEWER',
      ],
      provisioning_status: ['PENDING', 'VALIDATING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
      saas_provisioning_status: [
        'PENDING',
        'WAITING_INFRA',
        'READY_TO_PROVISION',
        'PROVISIONING',
        'ACTIVE',
        'FAILED',
        'CANCELLED',
      ],
      sales_agent_type: ['EBIM_INTERNAL', 'INDEPENDENT', 'PARTNER_AGENT'],
      settlement_status: ['OPEN', 'APPROVED', 'PAID', 'CANCELLED'],
      subscription_status: ['DRAFT', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED'],
      tenant_product_mapping_status: ['PENDING', 'ACTIVE', 'FAILED', 'SUSPENDED'],
      tenant_role: ['TENANT_ADMIN', 'TENANT_USER'],
      tenant_status: ['PENDING', 'ACTIVE', 'SUSPENDED', 'CHURNED', 'ARCHIVED'],
      tenant_type: ['DEMO', 'TRIAL', 'PRODUCTION', 'SANDBOX'],
      webhook_event_status: ['RECEIVED', 'PROCESSED', 'IGNORED', 'REJECTED'],
    },
  },
} as const;
