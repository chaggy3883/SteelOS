import React, { useState, useEffect } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  FolderKanban, DollarSign, AlertTriangle, CheckCircle2,
  Brain, TrendingUp, Clock, ArrowRight, Activity,
  Building2, Package, Zap
} from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar
} from 'recharts';

const productionData = [
  { month: 'Jan', tons: 420, pieces: 1240 },
  { month: 'Feb', tons: 380, pieces: 1100 },
  { month: 'Mar', tons: 510, pieces: 1480 },
  { month: 'Apr', tons: 490, pieces: 1390 },
  { month: 'May', tons: 620, pieces: 1820 },
  { month: 'Jun', tons: 580, pieces: 1650 },
];

const riskData = [
  { name: 'Contract', value: 35 },
  { name: 'Schedule', value: 55 },
  { name: 'Quality', value: 20 },
  { name: 'Financial', value: 40 },
  { name: 'Material', value: 15 },
];

export default function Dashboard() {
  const { user } = useOutletContext() || {};
  const [projects, setProjects] = useState([]);
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [proj, find] = await Promise.all([
        base44.entities.Project.filter({ is_archived: false }, '-created_date', 20),
        base44.entities.AIFinding.filter({ review_status: 'pending' }, '-created_date', 10),
      ]);
      setProjects(proj);
      setFindings(find);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const activeProjects = projects.filter(p => !['complete','cancelled'].includes(p.status));
  const totalValue = projects.reduce((sum, p) => sum + (p.contract_value || 0), 0);
  const highRiskProjects = projects.filter(p => ['high','critical'].includes(p.risk_level));
  const pendingFindings = findings.filter(f => f.review_status === 'pending');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{greeting}, {user?.full_name?.split(' ')[0] || 'there'}</h1>
          <p className="text-muted-foreground mt-0.5">Here's what's happening across SteelOS today.</p>
        </div>
        <Link to="/projects/new">
          <Button className="steel-gradient text-white border-0 shadow-lg shadow-blue-500/20">
            <FolderKanban className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Active Projects"
          value={loading ? '—' : activeProjects.length}
          subtitle={`${projects.length} total projects`}
          icon={FolderKanban}
          color="blue"
          trend="up"
          trendValue="+2 this month"
        />
        <StatsCard
          title="Contract Value"
          value={loading ? '—' : `$${(totalValue / 1000000).toFixed(1)}M`}
          subtitle="All active projects"
          icon={DollarSign}
          color="green"
          trend="up"
          trendValue="+12%"
        />
        <StatsCard
          title="AI Findings Pending"
          value={loading ? '—' : pendingFindings.length}
          subtitle="Require your review"
          icon={Brain}
          color="orange"
          trend={pendingFindings.length > 5 ? 'down' : 'up'}
          trendValue={pendingFindings.length > 5 ? 'Needs attention' : 'On track'}
        />
        <StatsCard
          title="High Risk Projects"
          value={loading ? '—' : highRiskProjects.length}
          subtitle="Require attention"
          icon={AlertTriangle}
          color={highRiskProjects.length > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Production Chart */}
        <div className="lg:col-span-2 steel-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold">Production Overview</h2>
              <p className="text-xs text-muted-foreground">Tons fabricated per month</p>
            </div>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Last 6 months</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={productionData}>
              <defs>
                <linearGradient id="tonsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(213 94% 45%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(213 94% 45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
              />
              <Area type="monotone" dataKey="tons" stroke="hsl(213 94% 45%)" fill="url(#tonsGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Risk Chart */}
        <div className="steel-card p-5">
          <div className="mb-4">
            <h2 className="font-semibold">Risk Distribution</h2>
            <p className="text-xs text-muted-foreground">Current risk scores</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={riskData} layout="vertical">
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={60} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
              />
              <Bar dataKey="value" fill="hsl(213 94% 45%)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Projects */}
        <div className="steel-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Recent Projects</h2>
            <Link to="/projects">
              <Button variant="ghost" size="sm" className="text-xs gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />
              ))
            ) : projects.length === 0 ? (
              <div className="text-center py-8">
                <FolderKanban className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No projects yet</p>
                <Link to="/projects/new">
                  <Button size="sm" className="mt-3">Create First Project</Button>
                </Link>
              </div>
            ) : (
              projects.slice(0, 5).map((project) => (
                <Link key={project.id} to={`/projects/${project.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{project.name}</p>
                        <p className="text-xs text-muted-foreground">{project.project_number} • {project.customer_name || 'No customer'}</p>
                      </div>
                    </div>
                    <StatusBadge status={project.status} />
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* AI Findings */}
        <div className="steel-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">AI Findings Requiring Review</h2>
              {pendingFindings.length > 0 && (
                <span className="text-xs bg-orange-500/10 text-orange-500 px-2 py-0.5 rounded-full font-medium">
                  {pendingFindings.length} pending
                </span>
              )}
            </div>
            <Link to="/intelligence">
              <Button variant="ghost" size="sm" className="text-xs gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />
              ))
            ) : pendingFindings.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">All findings reviewed</p>
              </div>
            ) : (
              pendingFindings.slice(0, 5).map((finding) => (
                <div key={finding.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted transition-colors">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                    finding.status === 'fail' ? 'bg-red-500' :
                    finding.status === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{finding.title}</p>
                    <p className="text-xs text-muted-foreground">{finding.category} • {finding.review_package}</p>
                  </div>
                  <StatusBadge status={finding.status} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}