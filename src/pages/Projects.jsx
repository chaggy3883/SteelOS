import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import {
  Plus, Search, Building2,
  MoreVertical, Star, StarOff, Archive, Eye, Package
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/ui/StatusBadge';
import PageHeader from '@/components/ui/PageHeader';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

const STATUS_FILTERS = ['all', 'estimating', 'awarded', 'engineering', 'fabrication', 'erection', 'complete'];

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => { loadProjects(); }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await db.entities.Project.filter({ is_archived: false }, '-created_date', 100);
      setProjects(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const togglePin = async (project) => {
    await db.entities.Project.update(project.id, { is_pinned: !project.is_pinned });
    loadProjects();
  };

  const archiveProject = async (project) => {
    await db.entities.Project.update(project.id, { is_archived: true });
    loadProjects();
  };

  const goToCustomer = (project) => {
    if (project.customer_id) navigate(`/crm?customer=${project.customer_id}`);
    else navigate(`/crm?search=${encodeURIComponent(project.customer_name)}`);
  };

  const filtered = projects.filter(p => {
    const matchSearch = !search ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.project_number?.toLowerCase().includes(search.toLowerCase()) ||
      p.customer_name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  }).sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0));

  const healthColor = (score) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} total projects`}
        actions={
          <Link to="/projects/new">
            <Button className="steel-gradient text-white border-0 shadow-lg shadow-blue-500/20">
              <Plus className="w-4 h-4 mr-2" /> New Project
            </Button>
          </Link>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search projects, numbers, customers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                statusFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold text-lg mb-1">No projects found</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {search ? 'Try a different search term' : 'Create your first project to get started'}
          </p>
          <Link to="/projects/new">
            <Button><Plus className="w-4 h-4 mr-2" /> Create Project</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(project => (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className="steel-card p-5 hover:shadow-lg transition-all group cursor-pointer"
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  {project.is_pinned && <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />}
                  <span className="text-xs text-muted-foreground font-mono">{project.project_number}</span>
                </div>
                <div
                  className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button onClick={() => togglePin(project)} className="p-1 rounded hover:bg-muted">
                    {project.is_pinned
                      ? <StarOff className="w-3.5 h-3.5 text-muted-foreground" />
                      : <Star className="w-3.5 h-3.5 text-muted-foreground" />
                    }
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 rounded hover:bg-muted">
                        <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => navigate(`/projects/${project.id}`)}>
                        <Eye className="w-4 h-4 mr-2" /> View Project
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate(`/projects/${project.id}/management`)}>
                        <Package className="w-4 h-4 mr-2" /> Lifecycle
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => archiveProject(project)} className="text-destructive">
                        <Archive className="w-4 h-4 mr-2" /> Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Project Name */}
              <Link to={`/projects/${project.id}`}>
                <h3 className="font-semibold text-base mb-1 hover:text-primary transition-colors line-clamp-2 flex items-center gap-1.5" title={project.name}>
                  {project.name}
                  {project.is_prevailing_wage && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-600 border border-purple-500/20 flex-shrink-0">Prevailing Wage</span>
                  )}
                </h3>
              </Link>
              {project.customer_name ? (
                <p
                  onClick={(e) => { e.stopPropagation(); goToCustomer(project); }}
                  className="text-sm text-muted-foreground mb-3 hover:text-primary hover:underline transition-colors inline-block"
                >
                  {project.customer_name}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mb-3">No customer assigned</p>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div onClick={() => navigate(`/projects/${project.id}`)} className="cursor-pointer">
                  <p className="text-xs text-muted-foreground">Contract Value</p>
                  <p className="text-sm font-semibold">
                    {project.contract_value ? `$${(project.contract_value / 1000).toFixed(0)}K` : '—'}
                  </p>
                </div>
                <div onClick={() => navigate(`/projects/${project.id}`)} className="cursor-pointer">
                  <p className="text-xs text-muted-foreground">Estimated Tons</p>
                  <p className="text-sm font-semibold">{project.estimated_tons ? `${project.estimated_tons}T` : '—'}</p>
                </div>
                <div onClick={() => navigate(`/projects/${project.id}`)} className="cursor-pointer">
                  <p className="text-xs text-muted-foreground">Completion</p>
                  <p className="text-sm font-semibold">{project.completion_date || '—'}</p>
                </div>
                <div onClick={() => navigate(`/projects/${project.id}`)} className="cursor-pointer">
                  <p className="text-xs text-muted-foreground">Health Score</p>
                  <p className={`text-sm font-bold ${healthColor(project.health_score || 100)}`}>
                    {project.health_score || 100}%
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <StatusBadge status={project.status} />
                <StatusBadge status={project.risk_level || 'low'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}