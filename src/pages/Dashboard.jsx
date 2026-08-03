import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Settings2, Plus, Check, Loader2 } from 'lucide-react';
import DashboardWidget from '@/components/dashboard/DashboardWidget';
import AddWidgetDrawer from '@/components/dashboard/AddWidgetDrawer';
import { getUserPermissions, getDefaultLayout, getWidgetById, WIDGET_LIBRARY } from '@/components/dashboard/rbacConfig';

// Native CSS grid — no third-party layout library. col-span/row-span classes
// per widget, computed from its stored `size`; the grid container itself is
// a plain fixed grid-cols-4 (no responsive breakpoint remapping), which is
// what makes this render identically on every machine regardless of screen
// size — the js-measured pixel positioning react-grid-layout used was the
// actual source of the cross-laptop inconsistency this replaces.
const SIZE_CLASSES = {
  '1x1': 'col-span-1 row-span-1',
  '2x2': 'col-span-2 row-span-2',
  '3x2': 'col-span-3 row-span-2',
};
const SIZE_OPTIONS = ['1x1', '2x2', '3x2'];

export default function Dashboard() {
  const { user } = useOutletContext() || {};
  const [layout, setLayout] = useState([]);
  const [configId, setConfigId] = useState(null);
  const [customizing, setCustomizing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showDrawer, setShowDrawer] = useState(false);
  const [allowedWidgets, setAllowedWidgets] = useState([]);

  React.useEffect(() => { if (user?.id) initDashboard(); }, [user?.id]);

  const initDashboard = async () => {
    try {
      const perms = await getUserPermissions(user.roles || ['user']);
      setAllowedWidgets(perms.widgets);
      const existing = await base44.entities.UserDashboardConfig.filter({ user_id: user.id }, '-created_date', 1);
      if (existing.length > 0 && (existing[0].is_customized || existing[0].layout?.length > 0)) {
        setLayout(existing[0].layout || []);
        setConfigId(existing[0].id);
      } else {
        const widgetIds = perms.widgets.includes('*') ? WIDGET_LIBRARY.map(w => w.id) : perms.widgets;
        const defaultLayout = getDefaultLayout(widgetIds);
        setLayout(defaultLayout);
        if (existing.length > 0) {
          setConfigId(existing[0].id);
          await base44.entities.UserDashboardConfig.update(existing[0].id, { layout: defaultLayout });
        } else {
          const created = await base44.entities.UserDashboardConfig.create({ user_id: user.id, layout: defaultLayout, is_customized: false });
          setConfigId(created.id);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // Every mutation here is a single deliberate click (delete / size-snap /
  // add) — not a continuous drag gesture — so there's no debounce needed
  // anymore: persist immediately, every time, straight through
  // base44.entities.UserDashboardConfig.update → localData.js's saveStore →
  // the /__db-sync file mirror, so a size change or deletion is on disk
  // before a refresh could ever race it.
  const persistLayout = async (newLayout) => {
    setLayout(newLayout);
    if (!configId) return;
    try {
      await base44.entities.UserDashboardConfig.update(configId, { layout: newLayout, is_customized: true });
    } catch (e) { console.error(e); }
  };

  const handleAddWidget = (widgetId) => {
    const widget = getWidgetById(widgetId);
    if (!widget) return;
    persistLayout([...layout, { i: widgetId, size: '1x1' }]);
    setShowDrawer(false);
  };

  const handleRemoveWidget = (widgetId) => {
    persistLayout(layout.filter(item => item.i !== widgetId));
  };

  const handleResizeWidget = (widgetId, size) => {
    persistLayout(layout.map(item => item.i === widgetId ? { ...item, size } : item));
  };

  const currentWidgetIds = layout.map(item => item.i);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{greeting}, {user?.full_name?.split(' ')[0] || 'there'}</h1>
          <p className="text-muted-foreground mt-0.5">Your personalized SteelOS dashboard.</p>
        </div>
        {customizing ? (
          <div className="flex gap-2">
            <Button onClick={() => setShowDrawer(true)} className="steel-gradient text-white border-0">
              <Plus className="w-4 h-4" />Add Widget
            </Button>
            <Button onClick={() => setCustomizing(false)} variant="default">
              <Check className="w-4 h-4" />Done
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setCustomizing(true)}>
            <Settings2 className="w-4 h-4" />Edit Dashboard Layout
          </Button>
        )}
      </div>

      {customizing && (
        <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary flex items-center gap-2">
          <Settings2 className="w-4 h-4" />
          <span>Click the red button to remove a widget • Pick 1x1/2x2/3x2 to resize • Changes save immediately</span>
        </div>
      )}

      {layout.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-sm text-muted-foreground">Your dashboard is empty. Add widgets to get started.</p>
          <Button onClick={() => setCustomizing(true)} className="steel-gradient text-white border-0">
            <Plus className="w-4 h-4" />Add Widgets
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-6 w-full max-w-none px-6 auto-rows-[200px]">
          {layout.map(item => (
            <div key={item.i} className={SIZE_CLASSES[item.size || '1x1']}>
              <DashboardWidget
                widgetId={item.i}
                customizing={customizing}
                size={item.size || '1x1'}
                sizeOptions={SIZE_OPTIONS}
                onRemove={() => handleRemoveWidget(item.i)}
                onResize={(size) => handleResizeWidget(item.i, size)}
              />
            </div>
          ))}
        </div>
      )}

      <AddWidgetDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        allowedWidgets={allowedWidgets}
        currentWidgetIds={currentWidgetIds}
        onAdd={handleAddWidget}
      />
    </div>
  );
}
