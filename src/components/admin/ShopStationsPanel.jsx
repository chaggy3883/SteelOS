import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Save, Plus, ArrowUp, ArrowDown, Archive, RotateCcw, X, Route as RouteIcon, Factory, ListChecks } from 'lucide-react';
import { ROUTE_ITEM_TYPES, nextStationId } from '@/lib/shopStations';
import { useShopStationConfig, saveShopStationConfig } from '@/lib/shopStationsStore';
import { newRouteId } from '@/lib/shopRoutes';

// Admin > Shop Stations & Routes. Guided, three plain-language steps:
//   1. Your stations   (add, rename, reorder, retire — retiring never deletes history)
//   2. Routes          (named, ordered lists of stations)
//   3. Default routes  (which route each kind of piece follows unless a piece overrides it)
// Saved onto the company's SystemSetting('production') row — see
// src/lib/shopStations.js for why that row and how ids stay compatible.

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';

const stripStation = (s) => ({
  id: s.id, name: s.name, short_code: s.short_code, sort_order: s.sort_order, is_active: s.is_active, shop_floor_zone_id: s.shop_floor_zone_id || '',
});

export default function ShopStationsPanel() {
  const { toast } = useToast();
  const config = useShopStationConfig();
  const [zones, setZones] = useState([]);
  const [stations, setStations] = useState(null);
  const [routes, setRoutes] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [saving, setSaving] = useState('');
  const [newStationName, setNewStationName] = useState('');
  const [newRouteName, setNewRouteName] = useState('');
  const [step, setStep] = useState(1);
  const [me, setMe] = useState(null);

  useEffect(() => {
    db.entities.ShopFloorZone.list('label', 200).then(setZones).catch(() => setZones([]));
    db.auth.me().then(setMe).catch(() => setMe(null));
  }, []);

  // Seed the editable drafts from the loaded config (the six defaults when
  // the company has never saved anything) — re-seeded after every save.
  useEffect(() => {
    setStations(config.stations.map(stripStation));
    setRoutes(config.routes.map((r) => ({ ...r, station_ids: [...r.station_ids] })));
    setDefaults({ ...config.defaultRouteByItemType });
  }, [config]);

  const stationById = useMemo(() => new Map((stations || []).map((s) => [s.id, s])), [stations]);
  const activeStations = (stations || []).filter((s) => s.is_active);
  const changedBy = me?.full_name || me?.email || '';

  if (!stations || !routes || !defaults) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  const updateStation = (id, patch) => setStations((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const moveStation = (id, dir) => setStations((prev) => {
    const list = [...prev];
    const i = list.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return prev;
    [list[i], list[j]] = [list[j], list[i]];
    return list.map((s, idx) => ({ ...s, sort_order: idx + 1 }));
  });

  const addStation = () => {
    const name = newStationName.trim();
    if (!name) return;
    if (stations.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: `There's already a station called ${name}`, variant: 'destructive' });
      return;
    }
    const id = nextStationId(stations);
    setStations((prev) => [...prev, { id, name, short_code: name.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase(), sort_order: prev.length + 1, is_active: true, shop_floor_zone_id: '' }]);
    setNewStationName('');
  };

  const toggleRetire = (station) => {
    if (station.is_active) {
      const usedIn = routes.filter((r) => r.is_active && r.station_ids.includes(station.id)).map((r) => r.name);
      const msg = `Retire ${station.name}?\n\nIt will stop showing on scan screens and in new routes. Every piece's history at ${station.name} stays exactly as it is.${usedIn.length ? `\n\nStill used by route(s): ${usedIn.join(', ')} — pieces on those routes will be warned they skipped it until you take it out of the route.` : ''}`;
      if (!window.confirm(msg)) return;
    }
    updateStation(station.id, { is_active: !station.is_active });
  };

  const saveStations = async () => {
    if (stations.some((s) => !s.name.trim())) {
      toast({ title: 'Every station needs a name', variant: 'destructive' });
      return;
    }
    setSaving('stations');
    try {
      await saveShopStationConfig({ shop_stations: stations.map((s, i) => ({ ...stripStation(s), name: s.name.trim(), short_code: (s.short_code || '').trim().toUpperCase(), sort_order: i + 1 })) }, changedBy);
      toast({ title: 'Stations saved' });
    } catch {
      toast({ title: 'Could not save stations', variant: 'destructive' });
    } finally { setSaving(''); }
  };

  const updateRoute = (id, patch) => setRoutes((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRoute = () => {
    const name = newRouteName.trim();
    if (!name) return;
    setRoutes((prev) => [...prev, { id: newRouteId(), name, station_ids: [], is_active: true }]);
    setNewRouteName('');
  };
  const addStopToRoute = (route, stationId) => {
    if (!stationId) return;
    updateRoute(route.id, { station_ids: [...route.station_ids, Number(stationId)] });
  };
  const moveStop = (route, index, dir) => {
    const list = [...route.station_ids];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    updateRoute(route.id, { station_ids: list });
  };
  const removeStop = (route, index) => updateRoute(route.id, { station_ids: route.station_ids.filter((_, i) => i !== index) });

  const saveRoutes = async () => {
    if (routes.some((r) => r.is_active && r.station_ids.length === 0)) {
      toast({ title: 'Add at least one station to every route', description: 'Or retire the empty route.', variant: 'destructive' });
      return;
    }
    setSaving('routes');
    try {
      // Saving stations alongside keeps a just-added station (step 1, not
      // yet saved) from being dropped out of a route that uses it.
      await saveShopStationConfig({
        shop_stations: stations.map((s, i) => ({ ...stripStation(s), sort_order: i + 1 })),
        shop_routes: routes.map((r) => ({ id: r.id, name: r.name.trim() || 'Unnamed route', station_ids: r.station_ids, is_active: r.is_active })),
      }, changedBy);
      toast({ title: 'Routes saved' });
    } catch {
      toast({ title: 'Could not save routes', variant: 'destructive' });
    } finally { setSaving(''); }
  };

  const saveDefaults = async () => {
    setSaving('defaults');
    try {
      const clean = {};
      Object.entries(defaults).forEach(([k, v]) => { if (v) clean[k] = v; });
      await saveShopStationConfig({ default_route_by_item_type: clean }, changedBy);
      toast({ title: 'Default routes saved' });
    } catch {
      toast({ title: 'Could not save default routes', variant: 'destructive' });
    } finally { setSaving(''); }
  };

  const steps = [
    { n: 1, label: 'Your stations', icon: Factory },
    { n: 2, label: 'Routes', icon: RouteIcon },
    { n: 3, label: 'Default route by piece type', icon: ListChecks },
  ];

  return (
    <div className="max-w-4xl space-y-4">
      <div className="steel-card p-4">
        <h3 className="font-semibold">Shop Stations &amp; Routes</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Set up the stations on your shop floor and the order pieces move through them. When a piece is scanned at a station it hasn&apos;t reached yet, the shop gets a heads-up warning — it never blocks the work.
          {!config.isConfigured && ' You haven\'t changed anything yet, so the standard six stations are in use.'}
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {steps.map(({ n, label, icon: Icon }) => (
            <button key={n} type="button" onClick={() => setStep(n)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${step === n ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px]">{n}</span><Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="steel-card p-4 space-y-3">
          <div>
            <h4 className="font-semibold text-sm">Step 1 — Your stations</h4>
            <p className="text-xs text-muted-foreground">Top to bottom is the order pieces normally move through the shop. Use the arrows to reorder. Retired stations disappear from scan screens but keep all their history.</p>
          </div>
          <div className="space-y-2">
            {stations.map((s, i) => (
              <div key={s.id} className={`grid grid-cols-12 items-center gap-2 rounded-lg border border-border p-2 ${s.is_active ? '' : 'opacity-60 bg-muted/40'}`}>
                <div className="col-span-1 flex flex-col">
                  <button type="button" title="Move up" disabled={i === 0} onClick={() => moveStation(s.id, -1)} className="disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" title="Move down" disabled={i === stations.length - 1} onClick={() => moveStation(s.id, 1)} className="disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                </div>
                <div className="col-span-4">
                  <Label className="text-[10px] text-muted-foreground">Station name</Label>
                  <Input value={s.name} onChange={(e) => updateStation(s.id, { name: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px] text-muted-foreground">Short code</Label>
                  <Input value={s.short_code} maxLength={8} onChange={(e) => updateStation(s.id, { short_code: e.target.value.toUpperCase() })} />
                </div>
                <div className="col-span-3">
                  <Label className="text-[10px] text-muted-foreground">Floor zone (optional)</Label>
                  <select className={selectClass} value={s.shop_floor_zone_id || ''} onChange={(e) => updateStation(s.id, { shop_floor_zone_id: e.target.value })}>
                    <option value="">— none —</option>
                    {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2 flex justify-end">
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => toggleRetire(s)}>
                    {s.is_active ? <><Archive className="w-3.5 h-3.5" />Retire</> : <><RotateCcw className="w-3.5 h-3.5" />Bring back</>}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={newStationName} onChange={(e) => setNewStationName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStation()} placeholder="New station name, e.g. Plasma Table" />
            <Button variant="outline" className="gap-1" onClick={addStation}><Plus className="w-4 h-4" />Add station</Button>
          </div>
          <div className="flex items-center gap-2 pt-3 border-t border-border">
            <Button onClick={saveStations} disabled={saving === 'stations'} className="steel-gradient text-white border-0 gap-1">
              {saving === 'stations' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save stations
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)}>Next: routes →</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="steel-card p-4 space-y-3">
          <div>
            <h4 className="font-semibold text-sm">Step 2 — Routes</h4>
            <p className="text-xs text-muted-foreground">A route is the list of stations a kind of piece goes through, in order — e.g. &quot;Beam: Saw → Drill → Fit → Weld → Paint&quot; or &quot;Plate: Burn → Fit → Weld&quot;.</p>
          </div>
          {routes.length === 0 && <p className="text-sm text-muted-foreground">No routes yet. Pieces without a route never get a skipped-step warning.</p>}
          {routes.map((route) => (
            <div key={route.id} className={`rounded-lg border border-border p-3 space-y-2 ${route.is_active ? '' : 'opacity-60 bg-muted/40'}`}>
              <div className="flex items-center gap-2">
                <Input value={route.name} onChange={(e) => updateRoute(route.id, { name: e.target.value })} className="max-w-xs" />
                <Button size="sm" variant="outline" className="gap-1 ml-auto" onClick={() => updateRoute(route.id, { is_active: !route.is_active })}>
                  {route.is_active ? <><Archive className="w-3.5 h-3.5" />Retire route</> : <><RotateCcw className="w-3.5 h-3.5" />Bring back</>}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {route.station_ids.length === 0 && <span className="text-xs text-muted-foreground">No stations yet — add the first one →</span>}
                {route.station_ids.map((id, i) => {
                  const st = stationById.get(id);
                  return (
                    <span key={`${id}-${i}`} className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${st?.is_active === false ? 'border-amber-500/40 bg-amber-500/10 text-amber-700' : 'border-border bg-background'}`}>
                      <span className="text-muted-foreground">{i + 1}.</span>{st?.name || `Station ${id}`}{st?.is_active === false ? ' (retired)' : ''}
                      <button type="button" title="Move earlier" disabled={i === 0} onClick={() => moveStop(route, i, -1)} className="disabled:opacity-30"><ArrowUp className="w-3 h-3 -rotate-90" /></button>
                      <button type="button" title="Move later" disabled={i === route.station_ids.length - 1} onClick={() => moveStop(route, i, 1)} className="disabled:opacity-30"><ArrowDown className="w-3 h-3 -rotate-90" /></button>
                      <button type="button" title="Take out of route" onClick={() => removeStop(route, i)}><X className="w-3 h-3" /></button>
                    </span>
                  );
                })}
                <select className="h-7 rounded-md border border-input bg-background px-1 text-xs" value="" onChange={(e) => addStopToRoute(route, e.target.value)}>
                  <option value="">+ add station…</option>
                  {activeStations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Input value={newRouteName} onChange={(e) => setNewRouteName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRoute()} placeholder="New route name, e.g. Beam or Plate" />
            <Button variant="outline" className="gap-1" onClick={addRoute}><Plus className="w-4 h-4" />Add route</Button>
          </div>
          <div className="flex items-center gap-2 pt-3 border-t border-border">
            <Button onClick={saveRoutes} disabled={saving === 'routes'} className="steel-gradient text-white border-0 gap-1">
              {saving === 'routes' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save routes
            </Button>
            <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
            <Button variant="ghost" onClick={() => setStep(3)}>Next: default routes →</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="steel-card p-4 space-y-3">
          <div>
            <h4 className="font-semibold text-sm">Step 3 — Default route by piece type</h4>
            <p className="text-xs text-muted-foreground">Pick the route each kind of piece follows. You can still give any single piece its own route from its detail window in Production.</p>
          </div>
          {config.routes.filter((r) => r.is_active).length === 0 && <p className="text-sm text-amber-700">Save at least one route in step 2 first.</p>}
          <div className="grid gap-2 md:grid-cols-2">
            {ROUTE_ITEM_TYPES.map((t) => (
              <div key={t.value}>
                <Label className="text-xs">{t.label}</Label>
                <select className={`${selectClass} mt-1`} value={defaults[t.value] || ''} onChange={(e) => setDefaults((prev) => ({ ...prev, [t.value]: e.target.value }))}>
                  <option value="">No route (no skipped-step check)</option>
                  {config.routes.filter((r) => r.is_active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-3 border-t border-border">
            <Button onClick={saveDefaults} disabled={saving === 'defaults'} className="steel-gradient text-white border-0 gap-1">
              {saving === 'defaults' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save default routes
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)}>← Back</Button>
          </div>
        </div>
      )}
    </div>
  );
}
