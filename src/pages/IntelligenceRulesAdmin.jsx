import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { isAdminUser } from '@/lib/tenantContext';
import { suggestNextRule } from '@/lib/intelligenceRuleEngine';
import { ShieldCheck, Plus, Trash2, Loader2, Brain, Sparkles, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

const SEVERITY_STYLES = {
  critical: 'bg-red-500/15 text-red-500',
  warning: 'bg-yellow-500/15 text-yellow-600',
  info: 'bg-blue-500/15 text-blue-500',
};

const SeverityBadge = ({ severity }) => (
  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${SEVERITY_STYLES[severity] || SEVERITY_STYLES.info}`}>
    {severity}
  </span>
);

export default function IntelligenceRulesAdmin() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    db.auth.me().then((u) => { setCurrentUser(u); setCheckingAccess(false); }).catch(() => setCheckingAccess(false));
  }, []);

  useEffect(() => { loadRules(); }, []);

  const loadRules = async () => {
    setLoading(true);
    try {
      const list = await db.entities.IntelligenceRule.list('-created_date', 200);
      setRules(list);
    } catch (e) {
      setRules([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (rule) => {
    if (rule.approval_status === 'pending_review') {
      toast({ title: 'Approval required', description: 'This AI-suggested rule must be approved before it can be activated.', variant: 'destructive' });
      return;
    }
    try {
      const updated = await db.entities.IntelligenceRule.update(rule.id, { is_active: !rule.is_active });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (e) {
      toast({ title: 'Failed to update rule', variant: 'destructive' });
    }
  };

  const handleDelete = async (rule) => {
    if (!confirm(`Delete rule "${rule.rule_name}"? This cannot be undone.`)) return;
    try {
      await db.entities.IntelligenceRule.delete(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      toast({ title: 'Rule deleted' });
    } catch (e) {
      toast({ title: 'Failed to delete rule', variant: 'destructive' });
    }
  };

  // AI suggestion always lands as is_active:false / approval_status:'pending_review'
  // — suggestNextRule() already sets both, but they're re-asserted here so a
  // future edit to that function can never accidentally auto-activate a rule.
  const handleSuggest = async () => {
    setSuggesting(true);
    try {
      const suggestion = await suggestNextRule();
      if (!suggestion) {
        toast({ title: 'No new suggestions', description: 'Every watched entity already has a rule configured.' });
        return;
      }
      const created = await db.entities.IntelligenceRule.create({
        ...suggestion,
        source: 'ai_suggested',
        approval_status: 'pending_review',
        is_active: false,
      });
      setRules((prev) => [created, ...prev]);
      toast({ title: 'AI suggested a new rule', description: `"${created.rule_name}" is awaiting your review.` });
    } catch (e) {
      toast({ title: 'Failed to generate a suggestion', variant: 'destructive' });
    } finally {
      setSuggesting(false);
    }
  };

  const approveAndActivate = async (rule) => {
    try {
      const updated = await db.entities.IntelligenceRule.update(rule.id, {
        approval_status: 'approved',
        is_active: true,
        approved_by: currentUser?.full_name || currentUser?.email || 'Admin',
        approved_date: new Date().toISOString(),
      });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
      toast({ title: 'Rule approved and activated' });
    } catch (e) {
      toast({ title: 'Failed to approve rule', variant: 'destructive' });
    }
  };

  const rejectSuggestion = async (rule) => {
    if (!confirm(`Reject the suggested rule "${rule.rule_name}"?`)) return;
    try {
      await db.entities.IntelligenceRule.delete(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      toast({ title: 'Suggestion rejected' });
    } catch (e) {
      toast({ title: 'Failed to reject suggestion', variant: 'destructive' });
    }
  };

  if (checkingAccess) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!isAdminUser(currentUser)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Admin Access Required</h2>
        <p className="text-sm text-muted-foreground">You need administrator privileges to manage intelligence rules.</p>
      </div>
    );
  }

  const pendingReview = rules.filter((r) => r.approval_status === 'pending_review');
  const reviewedRules = rules.filter((r) => r.approval_status !== 'pending_review');

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Intelligence Rules"
        subtitle="Configurable rules the intelligence engine evaluates against live data — see the Intelligence Signals panel for what they surface."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleSuggest} disabled={suggesting}>
              {suggesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Suggest Rule (AI)
            </Button>
            <Button onClick={() => navigate('/admin/intelligence-rules/new')} className="steel-gradient text-white border-0">
              <Plus className="w-4 h-4" />Add Rule
            </Button>
          </div>
        }
      />

      {pendingReview.length > 0 && (
        <div className="mb-6 steel-card border-blue-500/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-blue-500/5 flex items-center gap-2">
            <Brain className="w-4 h-4 text-blue-500" />
            <h3 className="font-semibold text-sm">Pending AI Review ({pendingReview.length})</h3>
          </div>
          <div className="divide-y divide-border">
            {pendingReview.map((rule) => (
              <div key={rule.id} className="p-4 flex items-start justify-between gap-4">
                <button className="text-left flex-1 min-w-0" onClick={() => navigate(`/admin/intelligence-rules/${rule.id}`)}>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-semibold">{rule.rule_name}</span>
                    <SeverityBadge severity={rule.severity} />
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{rule.entity_watched}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{rule.ai_suggestion_rationale || rule.description}</p>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button size="sm" variant="outline" className="text-green-600 border-green-500/30" onClick={() => approveAndActivate(rule)}>
                    <Check className="w-3.5 h-3.5 mr-1" />Approve & Activate
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive border-destructive/30" onClick={() => rejectSuggestion(rule)}>
                    <X className="w-3.5 h-3.5 mr-1" />Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Rule</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Watching</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Condition</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Severity</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Active?</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></td></tr>
            ) : reviewedRules.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-muted-foreground">
                  No intelligence rules yet. Click "Add Rule" to create one.
                </td>
              </tr>
            ) : reviewedRules.map((rule) => (
              <tr key={rule.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/admin/intelligence-rules/${rule.id}`)}>
                <td className="px-4 py-3 font-medium">{rule.rule_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{rule.entity_watched}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {rule.condition?.field} {rule.condition?.operator} {rule.condition?.threshold}
                </td>
                <td className="px-4 py-3"><SeverityBadge severity={rule.severity} /></td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Switch checked={!!rule.is_active} onCheckedChange={() => toggleActive(rule)} />
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(rule)}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
