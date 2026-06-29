import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckSquare, AlertTriangle, XCircle, FileText, Brain, CheckCircle2, Plus, Search, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Quality() {
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.AIFinding.filter({ review_package: 'quality_assurance' }, '-created_date', 100);
      setFindings(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const filtered = findings.filter(f =>
    !search || f.title?.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: findings.length,
    fail: findings.filter(f => f.status === 'fail').length,
    warning: findings.filter(f => f.status === 'warning').length,
    pass: findings.filter(f => f.status === 'pass').length,
    pending: findings.filter(f => f.review_status === 'pending').length,
  };

  const QA_CATEGORIES = [
    'AISC Certification', 'Welding Requirements', 'Inspection Hold Points',
    'Material Traceability', 'Surface Preparation', 'Bolting Inspection',
    'Third Party Inspection', 'NCR Procedures'
  ];

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Quality Assurance"
        subtitle="QA review findings, inspection records, and compliance tracking"
        actions={
          <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" /> New QA Record</Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total QA Findings', value: stats.total, icon: Brain, color: 'text-blue-500' },
          { label: 'Fail', value: stats.fail, icon: XCircle, color: 'text-red-500' },
          { label: 'Warning', value: stats.warning, icon: AlertTriangle, color: 'text-yellow-500' },
          { label: 'Pass', value: stats.pass, icon: CheckCircle2, color: 'text-green-500' },
          { label: 'Pending Review', value: stats.pending, icon: FileText, color: 'text-orange-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${color}`} />
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="findings">
        <TabsList className="mb-4">
          <TabsTrigger value="findings">AI QA Findings</TabsTrigger>
          <TabsTrigger value="checklist">QA Checklist</TabsTrigger>
          <TabsTrigger value="certifications">Certifications</TabsTrigger>
        </TabsList>

        <TabsContent value="findings">
          <div className="mb-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search QA findings..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 steel-card">
                <CheckSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No QA findings yet. Upload project documents to generate AI analysis.</p>
              </div>
            ) : (
              filtered.map(f => (
                <div key={f.id} className={`steel-card p-4 border-l-4 ${
                  f.status === 'fail' ? 'border-l-red-500' :
                  f.status === 'warning' ? 'border-l-yellow-500' :
                  f.status === 'pass' ? 'border-l-green-500' : 'border-l-blue-500'
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={f.status} />
                        {f.risk_level && <StatusBadge status={f.risk_level} />}
                        <span className="text-xs text-muted-foreground">{f.category}</span>
                      </div>
                      <p className="font-medium text-sm">{f.title}</p>
                      {f.ai_explanation && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{f.ai_explanation}</p>}
                      {f.specification_section && (
                        <p className="text-xs text-primary mt-1">§{f.specification_section} {f.page_number ? `• Pg. ${f.page_number}` : ''}</p>
                      )}
                    </div>
                    <StatusBadge status={f.review_status} label={f.review_status?.replace('_', ' ')} />
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="checklist">
          <div className="steel-card p-5">
            <h3 className="font-semibold mb-4">Standard QA Checklist Categories</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {QA_CATEGORIES.map(cat => (
                <div key={cat} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <CheckSquare className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{cat}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {findings.filter(f => f.category?.toLowerCase().includes(cat.toLowerCase().split(' ')[0])).length} findings
                  </span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="certifications">
          <div className="steel-card p-5">
            <h3 className="font-semibold mb-4">Required Certifications Tracker</h3>
            <div className="space-y-3">
              {[
                { cert: 'AISC Fabricator Certification', status: 'verified', expiry: '2026-03-15' },
                { cert: 'AWS Certified Welders (Active)', status: 'verified', expiry: null },
                { cert: 'WPS / PQR Documents', status: 'pending', expiry: null },
                { cert: 'SSPC QP 1 Certification', status: 'not_started', expiry: null },
                { cert: 'Third Party Inspection Agency', status: 'pending', expiry: null },
              ].map(item => (
                <div key={item.cert} className="flex items-center justify-between p-4 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    {item.status === 'verified'
                      ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                      : item.status === 'pending'
                      ? <Clock className="w-5 h-5 text-yellow-500" />
                      : <XCircle className="w-5 h-5 text-red-500" />
                    }
                    <div>
                      <p className="text-sm font-medium">{item.cert}</p>
                      {item.expiry && <p className="text-xs text-muted-foreground">Expires: {item.expiry}</p>}
                    </div>
                  </div>
                  <StatusBadge
                    status={item.status === 'verified' ? 'pass' : item.status === 'pending' ? 'warning' : 'fail'}
                    label={item.status === 'verified' ? 'Verified' : item.status === 'pending' ? 'Pending' : 'Required'}
                  />
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}