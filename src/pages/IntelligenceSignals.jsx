import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { isAdminUser } from '@/lib/tenantContext';
import { db } from '@/api/apiClient';
import { runIntelligenceRules } from '@/lib/intelligenceRuleEngine';
import { AlertTriangle, AlertCircle, Info, Loader2, Radar, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', icon: AlertTriangle, style: 'border-red-500/30 bg-red-500/5 text-red-500' },
  warning: { label: 'Warning', icon: AlertCircle, style: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-600' },
  info: { label: 'Info', icon: Info, style: 'border-blue-500/30 bg-blue-500/5 text-blue-500' },
};

const SignalRow = ({ signal }) => {
  const config = SEVERITY_CONFIG[signal.severity] || SEVERITY_CONFIG.info;
  const Icon = config.icon;
  return (
    <Link
      to={signal.link || '#'}
      className={`flex items-start gap-3 p-4 rounded-lg border transition-colors hover:bg-muted/40 ${config.style}`}
    >
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">{signal.record_label}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{signal.entity_watched}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{signal.rule_name}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {signal.field} = <span className="font-medium">{typeof signal.value === 'number' ? Math.round(signal.value * 100) / 100 : signal.value}</span>
          {' '}({signal.operator} {signal.threshold})
        </p>
      </div>
    </Link>
  );
};

export default function IntelligenceSignals() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    db.auth.me().then((u) => setIsAdmin(isAdminUser(u))).catch(() => setIsAdmin(false));
    loadSignals();
  }, []);

  const loadSignals = async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await runIntelligenceRules();
      setSignals(result);
    } catch (e) {
      setError(true);
      setSignals([]);
    } finally {
      setLoading(false);
    }
  };

  const bySeverity = {
    critical: signals.filter((s) => s.severity === 'critical'),
    warning: signals.filter((s) => s.severity === 'warning'),
    info: signals.filter((s) => s.severity === 'info'),
  };

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      <PageHeader
        title="Intelligence Signals"
        subtitle="Live signals surfaced by active intelligence rules, ranked by severity."
        actions={isAdmin ? (
          <Link to="/admin/intelligence-rules">
            <Button variant="outline"><Settings className="w-4 h-4" />Manage Rules</Button>
          </Link>
        ) : undefined}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
      ) : error ? (
        <div className="text-center py-16 steel-card text-muted-foreground">Failed to evaluate intelligence rules.</div>
      ) : signals.length === 0 ? (
        <div className="text-center py-20 steel-card">
          <Radar className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <h3 className="text-lg font-semibold mb-1">No active signals</h3>
          <p className="text-sm text-muted-foreground">Nothing currently trips an active intelligence rule.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {['critical', 'warning', 'info'].map((severity) => {
            const items = bySeverity[severity];
            if (items.length === 0) return null;
            const config = SEVERITY_CONFIG[severity];
            return (
              <div key={severity}>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  {config.label}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{items.length}</span>
                </h3>
                <div className="space-y-2">
                  {items.map((signal) => (
                    <SignalRow key={`${signal.rule_id}-${signal.record_id}`} signal={signal} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
