-- ============================================================================
-- MasterAdmin · Datos de demostración (gerencia-v4) — VERIFICACIÓN (solo lectura)
-- ----------------------------------------------------------------------------
-- Cifras clave del dataset en dólares equivalentes, con las tasas DEMO del
-- primer día de cada mes (misma regla que el consolidado: tasa ≤ fecha, 31 días).
-- `scope`: demo = solo gerencia-v4; total = demo + seed base.
-- ============================================================================

set search_path = platform, public, pg_catalog;

create or replace function pg_temp.usd(p_amount numeric, p_currency text, p_at date) returns numeric
language sql stable as $$
  select case when p_currency = 'USD' then p_amount
              else p_amount / nullif((select rate from platform.fx_rate_lookup('USD', p_currency, p_at, 31)), 0) end
$$;
create or replace function pg_temp.m(k int) returns date language sql stable as $$
  select (date_trunc('month', current_date) + make_interval(months => k))::date
$$;

\echo '== MRR al cierre de cada mes (USD equivalente; M0 = hoy)'
with months as (select k, pg_temp.m(k) as ms,
                       case when k = 0 then current_date else (pg_temp.m(k + 1) - 1) end as at
                  from generate_series(-18, 0) k),
mrr as (
  select mo.k, mo.ms, s.metadata ->> 'demo' = 'gerencia-v4' as is_demo,
         sum(pg_temp.usd(platform.signed_line_amount(si.charge_kind, si.amount)
               * case si.billing_interval when 'QUARTERLY' then 1 / 3.0 when 'YEARLY' then 1 / 12.0 else 1 end,
             s.currency, mo.ms)) as usd
    from months mo
    join platform.subscriptions s on s.started_on <= mo.at and (s.ends_on is null or s.ends_on >= mo.at)
                                 and s.status in ('ACTIVE', 'PAST_DUE', 'CANCELLED')
    join platform.subscription_items si on si.subscription_id = s.id
         and si.billing_interval <> 'ONE_TIME' and si.valid_from <= mo.at
         and (si.valid_to is null or si.valid_to >= mo.at)
    left join platform.tenants t on t.id = s.tenant_id
   where t.id is null or t.tenant_type <> 'DEMO'
   group by 1, 2, 3)
select to_char(ms, 'YYYY-MM') as mes,
       round(sum(usd) filter (where is_demo)) as mrr_demo_usd,
       round(sum(usd)) as mrr_total_usd
  from mrr group by k, ms order by k;

\echo '== Facturado vs cobrado por mes (demo, USD equivalente)'
with inv as (
  select date_trunc('month', i.issue_date)::date as ms, sum(pg_temp.usd(i.total, i.currency, i.issue_date)) as usd
    from platform.invoices i
   where i.metadata ->> 'demo' = 'gerencia-v4' and i.status not in ('DRAFT', 'VOID')
   group by 1),
col as (
  select date_trunc('month', p.paid_at)::date as ms, sum(pg_temp.usd(p.amount, p.currency, p.paid_at::date)) as usd
    from platform.payments p join platform.invoices i on i.id = p.invoice_id
   where i.metadata ->> 'demo' = 'gerencia-v4' and p.status = 'CONFIRMED'
   group by 1)
select to_char(inv.ms, 'YYYY-MM') as mes, round(inv.usd) as facturado_usd, round(coalesce(col.usd, 0)) as cobrado_usd,
       round(100 * coalesce(col.usd, 0) / nullif(inv.usd, 0), 1) as pct_cobro_mes
  from inv left join col using (ms) order by inv.ms;

\echo '== % de cobro de lo facturado en los 12 meses cerrados (demo)'
select round(100 * sum(pg_temp.usd(b.confirmed_paid, b.currency, b.issue_date))
             / nullif(sum(pg_temp.usd(b.total, b.currency, b.issue_date)), 0), 1) as pct_cobro_12m
  from platform.v_invoice_balances b join platform.invoices i on i.id = b.invoice_id
 where i.metadata ->> 'demo' = 'gerencia-v4' and b.is_receivable
   and b.issue_date >= pg_temp.m(-12) and b.issue_date < pg_temp.m(0);

\echo '== Cartera por antigüedad (demo, USD equivalente, a hoy)'
select b.aging_bucket, count(*) as facturas, round(sum(pg_temp.usd(b.balance, b.currency, current_date))) as saldo_usd
  from platform.v_invoice_balances b join platform.invoices i on i.id = b.invoice_id
 where i.metadata ->> 'demo' = 'gerencia-v4' and b.balance > 0
 group by 1 order by 1;

\echo '== Conteos'
select
  (select count(*) from platform.organizations where metadata ->> 'demo' = 'gerencia-v4' and metadata ->> 'rol' = 'cliente') as clientes,
  (select count(*) from platform.organizations where metadata ->> 'demo' = 'gerencia-v4' and metadata ->> 'rol' = 'partner') as partners,
  (select count(*) from platform.sales_agents where metadata ->> 'demo' = 'gerencia-v4') as comerciales,
  (select count(*) from platform.tenants where metadata ->> 'demo' = 'gerencia-v4') as tenants,
  (select count(*) from platform.subscriptions where metadata ->> 'demo' = 'gerencia-v4') as contratos,
  (select count(*) from platform.subscriptions where metadata ->> 'demo' = 'gerencia-v4' and status = 'CANCELLED') as bajas,
  (select count(*) from platform.invoices where metadata ->> 'demo' = 'gerencia-v4') as facturas,
  (select count(*) from platform.payments p join platform.invoices i on i.id = p.invoice_id
    where i.metadata ->> 'demo' = 'gerencia-v4') as cobros;

select e.status, e.currency, count(*) as eventos, sum(e.amount) as importe
  from platform.commission_events e join platform.sales_agents a on a.id = e.sales_agent_id
 where a.metadata ->> 'demo' = 'gerencia-v4'
 group by 1, 2 order by 1, 2;

select s.status, count(*) as liquidaciones, sum(s.total_amount) as total
  from platform.commission_settlements s join platform.sales_agents a on a.id = s.sales_agent_id
 where a.metadata ->> 'demo' = 'gerencia-v4' group by 1 order by 1;

select (select count(*) from platform.usage_events e join platform.tenants t on t.id = e.tenant_id
         where t.metadata ->> 'demo' = 'gerencia-v4') as eventos_uso,
       (select count(*) from platform.usage_period_aggregates a join platform.tenants t on t.id = a.tenant_id
         where t.metadata ->> 'demo' = 'gerencia-v4' and a.status = 'FINALIZED') as agregados_finalizados,
       (select count(*) from platform.ai_credit_ledger l join platform.tenants t on t.id = l.tenant_id
         where t.metadata ->> 'demo' = 'gerencia-v4') as movimientos_creditos,
       (select count(*) from platform.payment_links pl join platform.organizations o on o.id = pl.organization_id
         where o.metadata ->> 'demo' = 'gerencia-v4') as enlaces_pago,
       (select string_agg(s.status || ':' || to_char(s.period_start, 'YYYY-MM') || ':' || s.currency || '=' || s.fee_total, ', ')
          from platform.partner_fee_statements s join platform.organizations o on o.id = s.partner_organization_id
         where o.metadata ->> 'demo' = 'gerencia-v4') as tarifa_partner,
       (select count(*) from platform.cost_entries where metadata ->> 'demo' = 'gerencia-v4') as costos,
       (select count(*) from platform.billing_alerts a join platform.subscriptions s on s.id = a.subscription_id
         where s.metadata ->> 'demo' = 'gerencia-v4' and a.status = 'OPEN') as alertas_abiertas;
