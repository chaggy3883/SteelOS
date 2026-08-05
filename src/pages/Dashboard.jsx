import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { db } from '@/api/apiClient';
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

// This page's key inside the account's page_layouts_json dictionary (User or
// employees — see initDashboard). Only pages with an actual customizable
// widget grid ever get a key here; today that's just this one.
const PAGE_KEY = 'dashboard';

export default function Dashboard() {
  const { user } = useOutletContext() || {};
  const [layout, setLayout] = useState([]);
  const [pageLayouts, setPageLayouts] = useState({});
  const [targetEntity, setTargetEntity] = useState('User');
  const [targetId, setTargetId] = useState(null);
  const [customizing, setCustomizing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showDrawer, setShowDrawer] = useState(false);
  const [allowedWidgets, setAllowedWidgets] = useState([]);

  React.useEffect(() => { if (user?.id) initDashboard(); }, [user?.id]);

  const initDashboard = async () => {
    try {
      const perms = await getUserPermissions(user.roles || ['user']);
      setAllowedWidgets(perms.widgets);

      // Kiosk/employee-linked sessions personalize against their own
      // `employees` row instead of the office `User` row — the same
      // distinction NavBar.jsx already makes for permission overrides, so a
      // shared device logging in as different workers doesn't mix up whose
      // layout is whose.
      const entity = user?.employee_id ? 'employees' : 'User';
      const id = user?.employee_id || user?.id;
      setTargetEntity(entity);
      setTargetId(id);

      const record = user?.employee_id ? await db.entities.employees.get(user.employee_id) : user;
      const existingLayouts = record?.page_layouts_json || {};

      if (Array.isArray(existingLayouts[PAGE_KEY]) && existingLayouts[PAGE_KEY].length > 0) {
        setPageLayouts(existingLayouts);
        setLayout(existingLayouts[PAGE_KEY]);
      } else {
        const widgetIds = perms.widgets.includes('*') ? WIDGET_LIBRARY.map(w => w.id) : perms.widgets;
        const defaultLayout = getDefaultLayout(widgetIds);
        const seededLayouts = { ...existingLayouts, [PAGE_KEY]: defaultLayout };
        setLayout(defaultLayout);
        setPageLayouts(seededLayouts);
        await db.entities[entity].update(id, { page_layouts_json: seededLayouts });
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // Every mutation here is a single deliberate click (delete / size-snap /
  // add), so it persists immediately every time — no debounce. This only
  // ever touches this account's own PAGE_KEY block inside page_layouts_json
  // (spread-merged, so any other page's saved layout is untouched), straight
  // through db.entities[User|employees].update → localData.js's
  // saveStore → the /__db-sync file mirror onto db.json.
  const persistLayout = async (newLayout) => {
    setLayout(newLayout);
    const newPageLayouts = { ...pageLayouts, [PAGE_KEY]: newLayout };
    setPageLayouts(newPageLayouts);
    if (!targetId) return;
    try {
      await db.entities[targetEntity].update(targetId, { page_layouts_json: newPageLayouts });
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
          <span>Click the red button to remove a widget • Pick 1x1/2x2/3x2 to resize • Changes save immediately, to your account only</span>
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
