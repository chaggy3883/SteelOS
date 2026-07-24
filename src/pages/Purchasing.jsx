import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ShoppingCart, AlertTriangle, Package, TrendingDown, Plus, Search, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Purchasing() {
  const [inventory, setInventory] = useState([]);
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [invData, findData] = await Promise.all([
        base44.entities.InventoryItem.filter({ is_active: true }, '-created_date', 100),
        base44.entities.AIFinding.filter({ review_package: 'purchasing' }, '-created_date', 50),
      ]);
      setInventory(invData);
      setFindings(findData);
    } catch (e) {} finally { setLoading(false); }
  };

  const lowStock = inventory.filter(i => i.reorder_point && i.quantity_available <= i.reorder_point);
  const totalValue = inventory.reduce((s, i) => s + ((i.quantity_on_hand || 0) * (i.unit_cost || 0)), 0);

  const filteredInventory = inventory.filter(i =>
    !search || i.description?.toLowerCase().includes(search.toLowerCase()) || i.item_number?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Purchasing"
        subtitle="Material procurement and AI-flagged purchasing requirements"
        actions={
          <div className="flex gap-2">
            <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />New PO</Button>
            <Link to="/purchasing/module">
              <Button variant="outline" className="gap-2">
                <ArrowRight className="w-4 h-4" /> Procurement Module
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total SKUs', value: inventory.length, icon: Package, color: 'text-blue-500' },
          { label: 'Low Stock Alerts', value: lowStock.length, icon: AlertTriangle, color: 'text-orange-500' },
          { label: 'AI Purchasing Flags', value: findings.length, icon: TrendingDown, color: 'text-purple-500' },
          { label: 'Inventory Value', value: `$${(totalValue/1000).toFixed(0)}K`, icon: ShoppingCart, color: 'text-green-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="reorder">
        <TabsList className="mb-4">
          <TabsTrigger value="reorder">Reorder Alerts ({lowStock.length})</TabsTrigger>
          <TabsTrigger value="ai">AI Purchasing Flags ({findings.length})</TabsTrigger>
          <TabsTrigger value="all">All Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="reorder">
          {lowStock.length === 0 ? (
            <div className="text-center py-16 steel-card"><Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" /><p className="text-sm text-muted-foreground">No low stock alerts</p></div>
          ) : (
            <div className="steel-card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-3 px-4">Item</th><th className="text-left py-3 px-4">Category</th>
                  <th className="text-right py-3 px-4">On Hand</th><th className="text-right py-3 px-4">Reorder Point</th>
                </tr></thead>
                <tbody>
                  {lowStock.map(i => (
                    <tr key={i.id} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="py-3 px-4"><p className="font-medium">{i.description}</p><p className="text-xs text-muted-foreground">{i.item_number}</p></td>
                      <td className="py-3 px-4"><span className="text-xs bg-muted px-2 py-0.5 rounded">{i.category?.replace(/_/g,' ')}</span></td>
                      <td className="py-3 px-4 text-right font-mono text-orange-500 font-bold">{i.quantity_available ?? i.quantity_on_hand}</td>
                      <td className="py-3 px-4 text-right font-mono text-muted-foreground">{i.reorder_point}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="ai">
          {findings.length === 0 ? (
            <div className="text-center py-16 steel-card"><ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto mb-3" /><p className="text-sm text-muted-foreground">No AI purchasing flags. Upload project specifications to generate analysis.</p></div>
          ) : (
            <div className="space-y-3">
              {findings.map(f => (
                <div key={f.id} className={`steel-card p-4 border-l-4 ${f.status === 'fail' ? 'border-l-red-500' : f.status === 'warning' ? 'border-l-yellow-500' : 'border-l-blue-500'}`}>
                  <p className="font-medium text-sm">{f.title}</p>
                  {f.ai_explanation && <p className="text-xs text-muted-foreground mt-1">{f.ai_explanation}</p>}
                  {f.recommendation && <p className="text-xs text-primary mt-1">→ {f.recommendation}</p>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all">
          <div className="relative max-w-sm mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search inventory..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="steel-card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">Description</th><th className="text-left py-3 px-4">Category</th>
                <th className="text-left py-3 px-4">Grade/Size</th><th className="text-right py-3 px-4">Qty On Hand</th>
                <th className="text-right py-3 px-4">Unit Cost</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={5} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>)
                ) : filteredInventory.map(i => (
                  <tr key={i.id} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-3 px-4"><p className="font-medium">{i.description}</p><p className="text-xs text-muted-foreground">{i.item_number}</p></td>
                    <td className="py-3 px-4"><span className="text-xs bg-muted px-2 py-0.5 rounded">{i.category?.replace(/_/g,' ')}</span></td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{[i.material_grade, i.size].filter(Boolean).join(' / ') || '—'}</td>
                    <td className={`py-3 px-4 text-right font-mono font-bold ${i.reorder_point && i.quantity_on_hand <= i.reorder_point ? 'text-orange-500' : 'text-foreground'}`}>{i.quantity_on_hand ?? 0}</td>
                    <td className="py-3 px-4 text-right font-mono text-muted-foreground">{i.unit_cost ? `$${i.unit_cost.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}