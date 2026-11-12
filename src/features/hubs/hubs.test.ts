import { NAV_ITEMS } from '@/app/navigation';
import { HUB_PANELS } from './hubPanels';

describe('entradas con pestañas (V5 · F1)', () => {
  it('cada pestaña del menú tiene su pantalla y no sobra ninguna', () => {
    const withTabs = NAV_ITEMS.filter((i) => i.tabs);
    expect(Object.keys(HUB_PANELS).sort()).toEqual(withTabs.map((i) => i.to).sort());
    for (const item of withTabs) {
      expect(Object.keys(HUB_PANELS[item.to]!).sort()).toEqual(item.tabs!.map((t) => t.id).sort());
    }
  });
});
