export const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', group: 'General' },
    { to: '/products', label: 'SaaS Products', group: 'Catálogo' },
    { to: '/plans', label: 'Planes y licencias', group: 'Catálogo' },
    { to: '/feature-flags', label: 'Feature flags', group: 'Catálogo' },
    { to: '/organizations', label: 'Organizaciones', group: 'Cuentas', personas: ['EBIM', 'PARTNER'] },
    { to: '/partners', label: 'Partners / Resellers', group: 'Cuentas', personas: ['EBIM', 'PARTNER'] },
    { to: '/customers', label: 'Clientes', group: 'Cuentas', personas: ['EBIM', 'PARTNER'] },
    { to: '/tenants', label: 'Tenants', group: 'Cuentas' },
    { to: '/sales-agents', label: 'Comerciales', group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
    { to: '/attributions', label: 'Atribuciones', group: 'Comercial' },
    { to: '/commission-plans', label: 'Planes de comisión', group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
    { to: '/commissions', label: 'Comisiones y liquidaciones', group: 'Comercial' },
    { to: '/subscriptions', label: 'Suscripciones', group: 'Finanzas', personas: ['EBIM', 'PARTNER'] },
    { to: '/billing', label: 'Facturación y cobros', group: 'Finanzas', personas: ['EBIM', 'PARTNER'] },
    { to: '/costs', label: 'Costos y margen', group: 'Finanzas', personas: ['EBIM'] },
    { to: '/deployments', label: 'Deployments', group: 'Infraestructura', personas: ['EBIM', 'PARTNER'] },
    { to: '/provisioning', label: 'Provisioning', group: 'Infraestructura', personas: ['EBIM', 'PARTNER'] },
    { to: '/audit', label: 'Auditoría', group: 'Gobierno', personas: ['EBIM', 'PARTNER'] },
    { to: '/settings', label: 'Configuración', group: 'Gobierno' },
];
export function navItemsFor(persona) {
    return NAV_ITEMS.filter((item) => !item.personas || item.personas.includes(persona));
}
export function navGroupsFor(persona) {
    const items = navItemsFor(persona);
    const order = [];
    const map = new Map();
    for (const item of items) {
        if (!map.has(item.group)) {
            map.set(item.group, []);
            order.push(item.group);
        }
        map.get(item.group).push(item);
    }
    return order.map((group) => ({ group, items: map.get(group) }));
}
