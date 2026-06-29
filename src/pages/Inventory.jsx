import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { base44 } from '@/api/base44Client';
import { Package, Plus, Search, Warehouse, List, BarChart3, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import StatusBadge from '@/components/ui/StatusBadge';
import PageHeader from '@/components/ui/PageHeader';
import Warehouse3D from '@/components/warehouse/Warehouse3D';

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('list');

  useEffect(() => { loadItems(); }, []);

  const loadItems = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.InventoryItem.filter({ is_active: true }, '-created_date', 100);
      setItems(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const filtered = items.filter(i =>
    !search ||
    i.description?.toLowerCase().includes(search.toLowerCase()) ||
    i.item_number?.toLowerCase().includes(search.toLowerCase()) ||
    i.material_grade?.toLowerCase().includes(search.toLowerCase())
  );

  const lowStock = items.filter(i => i.reorder_point && i.quantity_available <= i.reorder_point);
  const totalValue = items.reduce((sum, i) => sum + ((i.quantity_on_hand || 0) * (i.unit_cost || 0)), 0);

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Inventory"
        subtitle="Material inventory and 3D warehouse management"
        actions={
          <Button className="steel-gradient text-white border-0">
            <Plus className="w-4 h-4 mr-2" /> Add Item
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total SKUs', value: items.length, color: 'text-blue-500' },
          { label: 'Low Stock Alerts', value: lowStock.length, color: lowStock.length > 0 ? 'text-red-500' : 'text-green-500' },
          { label: 'Inventory Value', value: `$${(totalValue/1000).toFixed(0)}K`, color: 'text-green-500' },
          { label: 'Zones', value: [...new Set(items.map(i=>i.warehouse_zone).filter(Boolean))].length || 0, color: 'text-purple-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="steel-card p-4">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      {lowStock.length > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20 mb-6">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-500">{lowStock.length} items below reorder point</p>
            <p className="text-xs text-muted-foreground">{lowStock.map(i => i.description).slice(0,3).join(', ')}{lowStock.length > 3 ? ` +${lowStock.length - 3} more` : ''}</p>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="list" className="gap-2"><List className="w-4 h-4" /> Inventory List</TabsTrigger>
          <TabsTrigger value="warehouse" className="gap-2"><Warehouse className="w-4 h-4" /> 3D Warehouse</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <div className="steel-card">
            <div className="p-4 border-b border-border">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search materials..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-3 px-4">Item</th>
                    <th className="text-left py-3 px-4">Category</th>
                    <th className="text-left py-3 px-4">Grade</th>
                    <th className="text-left py-3 px-4">Zone / Rack</th>
                    <th className="text-right py-3 px-4">On Hand</th>
                    <th className="text-right py-3 px-4">Available</th>
                    <th className="text-right py-3 px-4">Unit Cost</th>
                    <th className="text-left py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}><td colSpan={8} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">
                      <Package className="w-8 h-8 mx-auto mb-2" />
                      No inventory items found
                    </td></tr>
                  ) : (
                    filtered.map(item => (
                      <tr key={item.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                        <td className="py-3 px-4">
                          <p className="font-medium">{item.description}</p>
                          <p className="text-xs text-muted-foreground font-mono">{item.item_number}</p>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground capitalize">{item.category?.replace('_',' ')}</td>
                        <td className="py-3 px-4">{item.material_grade || '—'}</td>
                        <td className="py-3 px-4 text-muted-foreground font-mono text-xs">
                          {item.warehouse_zone || '—'}{item.warehouse_rack ? ` / ${item.warehouse_rack}` : ''}
                        </td>
                        <td className="py-3 px-4 text-right font-medium">{item.quantity_on_hand} {item.unit_of_measure}</td>
                        <td className={`py-3 px-4 text-right font-medium ${item.reorder_point && item.quantity_available <= item.reorder_point ? 'text-red-500' : ''}`}>
                          {item.quantity_available}
                        </td>
                        <td className="py-3 px-4 text-right">{item.unit_cost ? `$${item.unit_cost.toFixed(2)}` : '—'}</td>
                        <td className="py-3 px-4">
                          {item.reorder_point && item.quantity_available <= item.reorder_point
                            ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-500">Low Stock</span>
                            : <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">In Stock</span>
                          }
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="warehouse">
          <Warehouse3D items={items} />
        </TabsContent>
      </Tabs>
    </div>
  );
}