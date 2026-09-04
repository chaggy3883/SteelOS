import React, { useMemo } from 'react';
import { Activity, AlertTriangle, Gauge } from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function MetricsGrid({ logs, onViewLogs }) {
  const { totalVolume, errorRatePct, avgLatency, latencyByEndpoint } = useMemo(() => {
    const total = logs.length;
    const errors = logs.filter(l => Number(l.response_status) >= 400).length;
    const avgLat = total ? Math.round(logs.reduce((sum, l) => sum + Number(l.latency_ms || 0), 0) / total) : 0;

    const byEndpoint = new Map();
    logs.forEach(l => {
      const key = (l.endpoint_url || 'unknown').replace(/^https?:\/\//, '').split('/').slice(0, 2).join('/');
      const entry = byEndpoint.get(key) || { name: key, sum: 0, count: 0 };
      entry.sum += Number(l.latency_ms || 0);
      entry.count += 1;
      byEndpoint.set(key, entry);
    });

    return {
      totalVolume: total,
      errorRatePct: total ? Math.round((errors / total) * 1000) / 10 : 0,
      avgLatency: avgLat,
      latencyByEndpoint: Array.from(byEndpoint.values()).map(e => ({ name: e.name, value: Math.round(e.sum / e.count) })),
    };
  }, [logs]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard title="Total Transactions" value={totalVolume} subtitle="Logged API calls" icon={Activity} color="blue" onClick={onViewLogs} />
        <StatsCard title="Error Rate" value={`${errorRatePct}%`} subtitle="Non-200 responses" icon={AlertTriangle} color={errorRatePct > 10 ? 'red' : 'green'} onClick={onViewLogs} />
        <StatsCard title="Avg Latency" value={`${avgLatency} ms`} subtitle="Across all endpoints" icon={Gauge} color="purple" onClick={onViewLogs} />
      </div>

      <div className="steel-card p-5">
        <h3 className="font-semibold mb-4">Average Latency by Endpoint</h3>
        {latencyByEndpoint.length === 0
          ? <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No API traffic recorded yet</div>
          : <ResponsiveContainer width="100%" height={220}>
              <BarChart data={latencyByEndpoint}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} unit="ms" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                <Bar dataKey="value" name="Avg latency (ms)" fill="hsl(213 94% 45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
        }
      </div>
    </div>
  );
}
