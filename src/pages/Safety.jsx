import React, { useState, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { ShieldCheck, AlertTriangle, HardHat, FileWarning, CheckCircle2, ClipboardList } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SafetyMeetingLog from '@/components/safety/SafetyMeetingLog';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';

const SAFETY_ITEMS = [
  'Fall Protection Requirements (>6ft)', 'Site Safety Plan Required', 'OSHA 10/30 Hour Training',
  'Crane Lift Plan Required', 'Hot Work Permits', 'Confined Space Entry',
  'MSDS / SDS Requirements', 'Personal Protective Equipment (PPE)', 'Fire Watch Requirements',
  'Emergency Action Plan', 'Drug/Alcohol Testing', 'Background Check Requirements',
];

export default function Safety() {
  useDocumentTitle('SteelOS — Safety');
  const navigate = useNavigate();
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('meetings');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState(null);

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    db.auth.me().then((me) => setCurrentUser(me || null)).catch(() => setCurrentUser(null));
    getEffectiveCompany()
      .then((company) => setModuleAllowed(hasModule(company, '/safety')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await db.entities.AIFinding.filter({ review_package: 'safety' }, '-created_date', 100);
      setFindings(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const critical = findings.filter(f => f.risk_level === 'critical' || f.status === 'fail');
  const warnings = findings.filter(f => f.status === 'warning');
  const resolved = findings.filter(f => f.is_resolved);

  const filtered = findings.filter(f => {
    if (statusFilter === 'critical' && !(f.risk_level === 'critical' || f.status === 'fail')) return false;
    if (statusFilter === 'warning' && f.status !== 'warning') return false;
    if (statusFilter === 'resolved' && !f.is_resolved) return false;
    if (categoryFilter && !f.title?.toLowerCase().includes(categoryFilter.split(' ')[0].toLowerCase())) return false;
    return true;
  });

  const jumpToFindings = (status, category) => {
    setStatusFilter(status || 'all');
    setCategoryFilter(category || null);
    setActiveTab('findings');
  };

  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const showModule = moduleAllowed || isPlatformOperatorView;

  if (checkingModuleAccess) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  // Route guard — a direct URL to /safety can't bypass the nav's
  // module-pack filtering.
  if (!showModule) {
    return <ModuleLocked modulePath="/safety" title="Safety Not Included" />;
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader title="Safety" subtitle="Weekly toolbox talks, sign-in tracking, and AI-powered safety review findings" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Safety Flags', value: findings.length, icon: ShieldCheck, color: 'text-blue-500', status: 'all' },
          { label: 'Critical Issues', value: critical.length, icon: FileWarning, color: 'text-red-500', status: 'critical' },
          { label: 'Warnings', value: warnings.length, icon: AlertTriangle, color: 'text-yellow-500', status: 'warning' },
          { label: 'Resolved', value: resolved.length, icon: CheckCircle2, color: 'text-green-500', status: 'resolved' },
        ].map(({ label, value, icon: Icon, color, status }) => (
          <button key={label} onClick={() => jumpToFindings(status)} className="steel-card p-4 text-left hover:bg-muted/40 transition-colors">
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </button>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="meetings" className="gap-1.5"><ClipboardList className="w-3.5 h-3.5" />Safety Meetings</TabsTrigger>
          <TabsTrigger value="findings">AI Safety Findings</TabsTrigger>
          <TabsTrigger value="checklist">Safety Checklist</TabsTrigger>
        </TabsList>

        <TabsContent value="meetings">
          <SafetyMeetingLog />
        </TabsContent>

        <TabsContent value="findings">
          {(statusFilter !== 'all' || categoryFilter) && (
            <div className="mb-4">
              <button
                onClick={() => { setStatusFilter('all'); setCategoryFilter(null); }}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
              >
                Filtered: {categoryFilter || statusFilter} — clear
              </button>
            </div>
          )}
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 steel-card">
              <HardHat className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No safety findings yet. Upload project documents to generate safety analysis.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(f => (
                <div
                  key={f.id}
                  onClick={() => f.project_id && navigate(`/projects/${f.project_id}`)}
                  className={`steel-card p-4 border-l-4 ${f.project_id ? 'cursor-pointer hover:bg-muted/40 transition-colors' : ''} ${
                    f.status === 'fail' || f.risk_level === 'critical' ? 'border-l-red-500' :
                    f.status === 'warning' ? 'border-l-yellow-500' : 'border-l-blue-500'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={f.status} />
                        {f.risk_level && <StatusBadge status={f.risk_level} />}
                      </div>
                      <p className="font-medium text-sm">{f.title}</p>
                      {f.ai_explanation && <p className="text-xs text-muted-foreground mt-1">{f.ai_explanation}</p>}
                      {f.recommendation && <p className="text-xs text-primary mt-1">→ {f.recommendation}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="checklist">
          <div className="steel-card p-5">
            <h3 className="font-semibold mb-4">Standard Safety Review Checklist</h3>
            <div className="space-y-3">
              {SAFETY_ITEMS.map(item => {
                const matched = findings.find(f => f.title?.toLowerCase().includes(item.split(' ')[0].toLowerCase()));
                return (
                  <button
                    key={item}
                    onClick={() => jumpToFindings(null, item)}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <ShieldCheck className={`w-4 h-4 ${matched ? 'text-orange-500' : 'text-muted-foreground'}`} />
                      <span className="text-sm">{item}</span>
                    </div>
                    {matched
                      ? <StatusBadge status={matched.status} />
                      : <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Not Reviewed</span>
                    }
                  </button>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}