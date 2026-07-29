import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Button } from '@/components/ui/button';
import { Settings2, Plus, Check, Loader2 } from 'lucide-react';
import DashboardWidget from '@/components/dashboard/DashboardWidget';
import AddWidgetDrawer from '@/components/dashboard/AddWidgetDrawer';
import { getUserPermissions, getDefaultLayout, getWidgetById, WIDGET_LIBRARY } from '@/components/dashboard/rbacConfig';

const ResponsiveGridLayout = WidthProvider(Responsive);

export default function Dashboard() {
  const { user } = useOutletContext() || {};
  const [layout, setLayout] = useState([]);
  const [configId, setConfigId] = useState(null);
  const [customizing, setCustomizing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showDrawer, setShowDrawer] = useState(false);
  const [allowedWidgets, setAllowedWidgets] = useState([]);
  const saveTimer = useRef(null);

  useEffect(() => { if (user?.id) initDashboard(); }, [user?.id]);

  const initDashboard = async () => {
    try {
      const perms = await getUserPermissions(user.roles || ['user']);
      setAllowedWidgets(perms.widgets);
      const existing = await base44.entities.UserDashboardConfig.filter({ user_id: user.id }, '-created_date', 1);
      if (existing.length > 0 && existing[0].layout?.length > 0) {
        setLayout(existing[0].layout);
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

  const saveLayout = useCallback((newLayout) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (configId) {
        try { await base44.entities.UserDashboardConfig.update(configId, { layout: newLayout, is_customized: true }); }
        catch (e) { console.error(e); }
      }
    }, 800);
  }, [configId]);

  const handleLayoutChange = (newLayout) => {
    setLayout(newLayout);
    if (customizing) saveLayout(newLayout);
  };

  const handleAddWidget = (widgetId) => {
    const widget = getWidgetById(widgetId);
    if (!widget) return;
    const maxY = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    const newItem = { i: widgetId, x: 0, y: maxY, w: widget.defaultW, h: widget.defaultH, minW: widget.minW, minH: widget.minH };
    const newLayout = [...layout, newItem];
    setLayout(newLayout);
    saveLayout(newLayout);
    setShowDrawer(false);
  };

  const handleRemoveWidget = (widgetId) => {
    const newLayout = layout.filter(item => item.i !== widgetId);
    setLayout(newLayout);
    saveLayout(newLayout);
  };

  const handleExitCustomize = () => {
    setCustomizing(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (configId) base44.entities.UserDashboardConfig.update(configId, { layout, is_customized: true }).catch(() => {});
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
            <Button onClick={handleExitCustomize} variant="default">
              <Check className="w-4 h-4" />Done
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setCustomizing(true)}>
            <Settings2 className="w-4 h-4" />Customize Dashboard
          </Button>
        )}
      </div>

      {customizing && (
        <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary flex items-center gap-2">
          <Settings2 className="w-4 h-4" />
          <span>Drag widgets to reposition • Drag corners to resize • Click X to remove • Changes save automatically</span>
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
        <ResponsiveGridLayout
          className="layout"
          layouts={{ lg: layout, md: layout, sm: layout }}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 4, md: 4, sm: 2, xs: 1, xxs: 1 }}
          rowHeight={100}
          margin={[12, 12]}
          isDraggable={customizing}
          isResizable={customizing}
          compactType="vertical"
          onLayoutChange={handleLayoutChange}
        >
          {layout.map(item => (
            <div key={item.i}>
              <DashboardWidget widgetId={item.i} customizing={customizing} onRemove={() => handleRemoveWidget(item.i)} />
            </div>
          ))}
        </ResponsiveGridLayout>
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