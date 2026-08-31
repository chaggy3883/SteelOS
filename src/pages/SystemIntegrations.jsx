import React, { useState, useEffect, useCallback } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { db } from '@/api/apiClient';
import { Webhook } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import WebhookConsole from '@/components/system-integrations/WebhookConsole';
import MetricsGrid from '@/components/system-integrations/MetricsGrid';
import TokenVaultManager from '@/components/system-integrations/TokenVaultManager';

export default function SystemIntegrations() {
  useDocumentTitle('SteelOS — System Integrations');
  const [logs, setLogs] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [logData, tokenData] = await Promise.all([
        db.entities.ApiIntegrationLog.list('-processed_at', 100),
        db.entities.ApiTokenVault.list('-created_at', 100),
      ]);
      setLogs(logData);
      setTokens(tokenData);
    } catch (e) {
      setLogs([]);
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <div className="p-6">
      <PageHeader
        title="System Integrations"
        subtitle="External webhook traffic and developer API key management"
      />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading integrations…</div>
      ) : (
        <Tabs defaultValue="console">
          <TabsList>
            <TabsTrigger value="console"><Webhook className="w-3.5 h-3.5 mr-1.5" />Webhook Console</TabsTrigger>
            <TabsTrigger value="metrics">Performance Metrics</TabsTrigger>
            <TabsTrigger value="vault">Token Vault</TabsTrigger>
          </TabsList>

          <TabsContent value="console" className="mt-4">
            <WebhookConsole logs={logs} />
          </TabsContent>

          <TabsContent value="metrics" className="mt-4">
            <MetricsGrid logs={logs} />
          </TabsContent>

          <TabsContent value="vault" className="mt-4">
            <TokenVaultManager tokens={tokens} onChanged={loadData} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
