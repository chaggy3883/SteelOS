import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { isAdminUser } from '@/lib/tenantContext';
import { getAllRoles } from '@/components/dashboard/rbacConfig';
import { WATCHED_ENTITIES, CONDITION_OPERATORS } from '@/lib/intelligenceRuleEngine';
import { ShieldCheck, Loader2, Trash2, Check, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

// One metric field per entity_watched today — kept as a lookup (rather than
// a free-text input) so the condition UI stays aligned with exactly what
// src/lib/intelligenceRuleEngine.js's candidate builders actually compute,
// and so a new metric added there later just means adding an entry here.
const FIELD_OPTIONS = {
  Bid: [{ value: 'days_old', label: 'Days since bid due date (pricing age)' }],
  Project: [{ value: 'health_score', label: 'Health score (0-100)' }],
  Piece: [{ value: 'dwell_variance_pct', label: 'Dwell time variance % vs. target' }],
  Equipment: [{ value: 'days_until_expiration', label: 'Days until inspection expiration (negative = overdue)' }],
  JobCost: [{ value: 'overrun_pct', label: 'Job cost overrun % vs. estimate' }],
  Certification: [{ value: 'days_until_expiration', label: 'Days until certification expiration' }],
};

const DEFAULT_CONDITION_BY_ENTITY = {
  Bid: { field: 'days_old', operator: '>', threshold: 21 },
  Project: { field: 'health_score', operator: '<', threshold: 60 },
  Piece: { field: 'dwell_variance_pct', operator: '>', threshold: 25 },
  Equipment: { field: 'days_until_expiration', operator: '<=', threshold: 0 },
  JobCost: { field: 'overrun_pct', operator: '>=', threshold: 15 },
  Certification: { field: 'days_until_expiration', operator: '<=', threshold: 30 },
};

const emptyForm = () => ({
  rule_name: '',
  description: '',
  entity_watched: 'Bid',
  condition: { ...DEFAULT_CONDITION_BY_ENTITY.Bid },
  severity: 'warning',
  is_active: false,
  notify_roles: [],
});

export default function IntelligenceRuleDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { toast } = useToast();

  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [rule, setRule] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [roles, setRoles] = useState([]);

  useEffect(() => {
    db.auth.me().then((u) => { setCurrentUser(u); setCheckingAccess(false); }).catch(() => setCheckingAccess(false));
    getAllRoles().then(setRoles).catch(() => setRoles([]));
  }, []);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      setLoading(true);
      try {
        const record = await db.entities.IntelligenceRule.get(id);
        setRule(record);
        setForm({
          rule_name: record.rule_name || '',
          description: record.description || '',
          entity_watched: record.entity_watched || 'Bid',
          condition: record.condition || DEFAULT_CONDITION_BY_ENTITY[record.entity_watched] || {},
          severity: record.severity || 'warning',
          is_active: !!record.is_active,
          notify_roles: record.notify_roles || [],
        });
      } catch (e) {
        toast({ title: 'Rule not found', variant: 'destructive' });
        navigate('/admin/intelligence-rules');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew]);

  const isPendingReview = rule?.approval_status === 'pending_review';

  const handleEntityChange = (entity_watched) => {
    setForm((f) => ({ ...f, entity_watched, condition: { ...DEFAULT_CONDITION_BY_ENTITY[entity_watched] } }));
  };

  const toggleRole = (roleName) => {
    setForm((f) => ({
      ...f,
      notify_roles: f.notify_roles.includes(roleName)
        ? f.notify_roles.filter((r) => r !== roleName)
        : [...f.notify_roles, roleName],
    }));
  };

  const handleSave = async () => {
    if (!form.rule_name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        rule_name: form.rule_name.trim(),
        description: form.description.trim(),
        entity_watched: form.entity_watched,
        condition: {
          field: form.condition.field,
          operator: form.condition.operator,
          threshold: Number(form.condition.threshold),
        },
        severity: form.severity,
        // A pending-review rule can only flip is_active through the explicit
        // Approve & Activate action below — never through this generic save.
        is_active: isPendingReview ? false : form.is_active,
        notify_roles: form.notify_roles,
      };

      if (isNew) {
        const created = await db.entities.IntelligenceRule.create({ ...payload, source: 'manual', approval_status: 'approved' });
        toast({ title: 'Rule created' });
        navigate(`/admin/intelligence-rules/${created.id}`);
      } else {
        const updated = await db.entities.IntelligenceRule.update(id, payload);
        setRule(updated);
        toast({ title: 'Rule updated' });
      }
    } catch (e) {
      toast({ title: 'Failed to save rule', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete rule "${form.rule_name}"? This cannot be undone.`)) return;
    try {
      await db.entities.IntelligenceRule.delete(id);
      toast({ title: 'Rule deleted' });
      navigate('/admin/intelligence-rules');
    } catch (e) {
      toast({ title: 'Failed to delete rule', variant: 'destructive' });
    }
  };

  const approveAndActivate = async () => {
    try {
      const updated = await db.entities.IntelligenceRule.update(id, {
        approval_status: 'approved',
        is_active: true,
        approved_by: currentUser?.full_name || currentUser?.email || 'Admin',
        approved_date: new Date().toISOString(),
      });
      setRule(updated);
      setForm((f) => ({ ...f, is_active: true }));
      toast({ title: 'Rule approved and activated' });
    } catch (e) {
      toast({ title: 'Failed to approve rule', variant: 'destructive' });
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

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  const fieldOptions = FIELD_OPTIONS[form.entity_watched] || [];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button onClick={() => navigate('/admin/intelligence-rules')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" />Back to Intelligence Rules
      </button>

      <PageHeader
        title={isNew ? 'New Intelligence Rule' : form.rule_name}
        subtitle={isNew ? 'Define a condition for the engine to evaluate against live data.' : `Watching: ${form.entity_watched}`}
      />

      {!isNew && rule && (
        <div className="steel-card p-4 mb-6 flex flex-wrap items-center gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Source: </span>
            <span className="font-medium capitalize">{rule.source?.replace('_', ' ') || 'manual'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Approval: </span>
            <span className={`font-medium capitalize ${isPendingReview ? 'text-blue-500' : 'text-green-600'}`}>
              {rule.approval_status?.replace('_', ' ') || 'approved'}
            </span>
          </div>
          {rule.approved_by && (
            <div>
              <span className="text-muted-foreground">Approved by: </span>
              <span className="font-medium">{rule.approved_by}</span>
            </div>
          )}
          {isPendingReview && (
            <Button size="sm" variant="outline" className="text-green-600 border-green-500/30 ml-auto" onClick={approveAndActivate}>
              <Check className="w-3.5 h-3.5 mr-1.5" />Approve & Activate
            </Button>
          )}
        </div>
      )}

      {isPendingReview && rule?.ai_suggestion_rationale && (
        <div className="mb-6 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
          <span className="font-medium">AI rationale: </span>{rule.ai_suggestion_rationale}
        </div>
      )}

      <div className="steel-card p-5 space-y-4">
        <div>
          <Label>Rule Name</Label>
          <Input className="mt-1" value={form.rule_name} onChange={(e) => setForm((f) => ({ ...f, rule_name: e.target.value }))} placeholder="e.g. Bid pricing past hold window" />
        </div>

        <div>
          <Label>Description</Label>
          <Textarea className="mt-1" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What this rule watches for and why it matters." />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Entity Watched</Label>
            <Select value={form.entity_watched} onValueChange={handleEntityChange}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WATCHED_ENTITIES.map((entity) => <SelectItem key={entity} value={entity}>{entity}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Severity</Label>
            <Select value={form.severity} onValueChange={(severity) => setForm((f) => ({ ...f, severity }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['info', 'warning', 'critical'].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-muted/40 border border-border">
          <Label className="mb-2 block">Condition</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <Select value={form.condition.field} onValueChange={(field) => setForm((f) => ({ ...f, condition: { ...f.condition, field } }))}>
                <SelectTrigger><SelectValue placeholder="Field" /></SelectTrigger>
                <SelectContent>
                  {fieldOptions.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select value={form.condition.operator} onValueChange={(operator) => setForm((f) => ({ ...f, condition: { ...f.condition, operator } }))}>
                <SelectTrigger><SelectValue placeholder="Operator" /></SelectTrigger>
                <SelectContent>
                  {CONDITION_OPERATORS.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Input type="number" value={form.condition.threshold} onChange={(e) => setForm((f) => ({ ...f, condition: { ...f.condition, threshold: e.target.value } }))} placeholder="Threshold" />
            </div>
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Notify Roles</Label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {roles.map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.notify_roles.includes(r.value)} onCheckedChange={() => toggleRole(r.value)} />
                {r.label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border border-border">
          <div>
            <p className="text-sm font-medium">Active</p>
            <p className="text-xs text-muted-foreground">
              {isPendingReview ? 'Locked until this AI-suggested rule is approved above.' : 'Only active rules are evaluated by the intelligence engine.'}
            </p>
          </div>
          <Switch checked={form.is_active} disabled={isPendingReview} onCheckedChange={(is_active) => setForm((f) => ({ ...f, is_active }))} />
        </div>
      </div>

      <div className="flex items-center justify-between mt-6">
        {!isNew ? (
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" />Delete
          </Button>
        ) : <span />}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/admin/intelligence-rules')}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.rule_name.trim() || saving} className="steel-gradient text-white border-0">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{isNew ? 'Create Rule' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
