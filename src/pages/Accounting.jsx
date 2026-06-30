import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { DollarSign, TrendingUp, AlertCircle, Brain, BarChart3 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Accounting() {
  const [projects, setProjects] = useState([]);
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [projData, findData] = await Promise.all([
        base44.entities.Project.filter({ is_archived: false }, '-contract_value', 50),
        base44.entities.AIFinding.filter({ review_package: 'accounting' }, '-created_date', 50),
      ]);
      setProjects(projData);
      setFindings(findData);
    } catch (e) {} finally { setLoading(false); }
  };

  const totalContractValue = projects.reduce((s, p) => s + (p.contract_value || 0), 0);
  const activeProjects = projects.filter(p => !['complete','cancelled','lead'].includes(p.status));
  const activeValue = activeProjects.reduce((s, p) => s + (p.contract_value || 0), 0);

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader title="Accounting & Finance" subtitle="Job costing, financial tracking, and AI-flagged financial risks" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Contract Value', value: `$${(totalContractValue/1000000).toFixed(2)}M`, icon: DollarSign, color: 'text-green-500' },
          { label: 'Active Projects Value', value: `$${(activeValue/1000000).toFixed(2)}M`, icon: TrendingUp, color: 'text-blue-500' },
          { label: 'Projects with Risk', value: projects.filter(p => p.financial_risk > 0).length, icon: AlertCircle, color: 'text-orange-500' },
          { label: 'AI Financial Flags', value: findings.length, icon: Brain, color: 'text-purple-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="jobs">
        <TabsList className="mb-4">
          <TabsTrigger value="jobs">Job Costing Summary</TabsTrigger>
          <TabsTrigger value="ai">AI Financial Flags ({findings.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs">
          <div className="steel-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-3 px-4">Project</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-right py-3 px-4">Contract Value</th>
                    <th className="text-right py-3 px-4">Est. Tons</th>
                    <th className="text-right py-3 px-4">$/Ton</th>
                    <th className="text-left py-3 px-4">Risk Level</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={6} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>)
                  ) : projects.length === 0 ? (
                    <tr><td colSpan={6} className="py-16 text-center text-muted-foreground text-sm">No projects found</td></tr>
                  ) : (
                    projects.map(p => (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                        <td className="py-3 px-4">
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.project_number}</p>
                        </td>
                        <td className="py-3 px-4"><StatusBadge status={p.status} /></td>
                        <td className="py-3 px-4 text-right font-mono font-bold">
                          {p.contract_value ? `$${p.contract_value.toLocaleString()}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                          {p.estimated_tons ? `${p.estimated_tons.toLocaleString()} T` : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                          {p.contract_value && p.estimated_tons
                            ? `$${Math.round(p.contract_value / p.estimated_tons).toLocaleString()}`
                            : '—'}
                        </td>
                        <td className="py-3 px-4"><StatusBadge status={p.risk_level} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="ai">
          {findings.length === 0 ? (
            <div className="text-center py-16 steel-card">
              <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No AI financial findings yet. Upload project contracts to generate analysis.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {findings.map(f => (
                <div key={f.id} className={`steel-card p-4 border-l-4 ${f.status === 'fail' ? 'border-l-red-500' : f.status === 'warning' ? 'border-l-yellow-500' : 'border-l-blue-500'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={f.status} />
                    {f.risk_level && <StatusBadge status={f.risk_level} />}
                  </div>
                  <p className="font-medium text-sm">{f.title}</p>
                  {f.ai_explanation && <p className="text-xs text-muted-foreground mt-1">{f.ai_explanation}</p>}
                  {f.estimated_financial_impact && <p className="text-xs text-orange-500 mt-1 font-medium">Est. Impact: {f.estimated_financial_impact}</p>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}