import React, { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Code2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function formatPayload(payloadJson) {
  try {
    return JSON.stringify(JSON.parse(payloadJson), null, 2);
  } catch (e) {
    return payloadJson || '';
  }
}

export default function WebhookConsole({ logs }) {
  const [viewing, setViewing] = useState(null);

  return (
    <div className="steel-card p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Direction</TableHead>
            <TableHead>Endpoint</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Latency</TableHead>
            <TableHead>Processed</TableHead>
            <TableHead className="text-right">Payload</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                No API traffic recorded yet.
              </TableCell>
            </TableRow>
          )}
          {logs.map(log => {
            const isIncoming = log.payload_direction === 'Incoming';
            const isError = Number(log.response_status) >= 400;
            return (
              <TableRow key={log.id}>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    {isIncoming ? <ArrowDownToLine className="w-3.5 h-3.5 text-blue-500" /> : <ArrowUpFromLine className="w-3.5 h-3.5 text-purple-500" />}
                    {log.payload_direction}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs max-w-[280px] truncate" title={log.endpoint_url}>{log.endpoint_url}</TableCell>
                <TableCell>
                  <Badge variant={isError ? 'destructive' : 'secondary'} className={isError ? '' : 'bg-green-500/10 text-green-600 border-transparent'}>
                    {log.response_status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{log.latency_ms} ms</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {log.processed_at ? new Date(log.processed_at).toLocaleString() : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setViewing(log)}>
                    <Code2 className="w-3.5 h-3.5" /> View JSON
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{viewing?.endpoint_url}</DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-[60vh] whitespace-pre-wrap">
            {viewing ? formatPayload(viewing.payload_json) : ''}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
