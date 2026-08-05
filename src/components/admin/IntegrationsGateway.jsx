import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { Loader2, Plug } from 'lucide-react';
import { INTEGRATIONS } from '@/components/admin/adminConstants';
import IntegrationCard from '@/components/admin/IntegrationCard';

export default function IntegrationsGateway() {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadCredentials(); }, []);

  const loadCredentials = async () => {
    setLoading(true);
    try {
      const list = await db.entities.ApiCredential.list('-created_date', 50);
      setCredentials(list);
    } catch (e) { setCredentials([]); }
    finally { setLoading(false); }
  };

  const getCredential = (serviceName) => credentials.find(c => c.service_name === serviceName);

  return (
    <div className="space-y-4">
      <div className="steel-card p-4 flex items-start gap-3">
        <Plug className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium">External Ecosystem Manager</p>
          <p className="text-xs text-muted-foreground">Manage API credentials for third-party platform integrations. Sensitive keys are masked in the UI and encrypted at rest via the platform database layer.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {INTEGRATIONS.map(integration => (
            <IntegrationCard key={integration.value} integration={integration} credential={getCredential(integration.value)} onSaved={loadCredentials} />
          ))}
        </div>
      )}
    </div>
  );
}