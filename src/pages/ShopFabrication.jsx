import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { QrCode, ScanLine, ClipboardCheck, HardHat, PenTool, PaintBucket, PlayCircle, PauseCircle, CheckCircle2 } from 'lucide-react';

const stations = ['Receiving', 'Shot Blaster', 'Iron Worker', 'Drill Line', 'Fabricator (Layout/Tack)', 'Paint'];

export default function ShopFabrication() {
  const { toast } = useToast();
  const [pieces, setPieces] = useState([]);
  const [stationLogs, setStationLogs] = useState([]);
  const [qaInspections, setQaInspections] = useState([]);
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [employeeId, setEmployeeId] = useState('EMP-101');
  const [activeStation, setActiveStation] = useState('Receiving');
  const [loading, setLoading] = useState(true);
  const [scanValue, setScanValue] = useState('');
  const [currentTimer, setCurrentTimer] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pieceData, logsData, qaData] = await Promise.all([
        base44.entities.pieces.list('-created_date', 100),
        base44.entities.station_logs.list('-created_date', 100),
        base44.entities.qa_inspections.list('-created_date', 100),
      ]);
      setPieces(pieceData);
      setStationLogs(logsData);
      setQaInspections(qaData);
      if (pieceData[0]) setSelectedPiece(pieceData[0]);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleScan = () => {
    const found = pieces.find((piece) => piece.qr_code === scanValue || piece.piece_mark === scanValue);
    if (!found) {
      toast({ title: 'Piece not found', variant: 'destructive' });
      return;
    }
    setSelectedPiece(found);
    toast({ title: `Loaded ${found.piece_mark}` });
  };

  const logWork = async (mode) => {
    if (!selectedPiece) return;
    if (mode === 'start') {
      const startLog = await base44.entities.station_logs.create({
        piece_id: selectedPiece.id,
        piece_mark: selectedPiece.piece_mark,
        employee_id: employeeId,
        station: activeStation,
        status: 'In Progress',
        start_time: new Date().toISOString(),
        duration_minutes: 0,
      });
      setStationLogs([startLog, ...stationLogs]);
      setCurrentTimer(startLog.id);
      toast({ title: 'Work started' });
      return;
    }

    if (mode === 'complete' || mode === 'pause') {
      const active = stationLogs.find((entry) => entry.piece_id === selectedPiece.id && entry.status === 'In Progress');
      if (!active) return;
      const endTime = new Date().toISOString();
      const elapsed = Math.max(1, Math.round((new Date(endTime).getTime() - new Date(active.start_time).getTime()) / 60000));
      const updated = await base44.entities.station_logs.update(active.id, {
        status: mode === 'pause' ? 'Paused - In Progress' : 'Complete',
        end_time: endTime,
        duration_minutes: elapsed,
      });
      setStationLogs((current) => current.map((item) => (item.id === active.id ? updated : item)));
      setCurrentTimer(null);
      toast({ title: mode === 'pause' ? 'Timer paused' : 'Work completed' });
      return;
    }

    if (mode === 'resume') {
      const resumed = await base44.entities.station_logs.create({
        piece_id: selectedPiece.id,
        piece_mark: selectedPiece.piece_mark,
        employee_id: employeeId,
        station: activeStation,
        status: 'In Progress',
        start_time: new Date().toISOString(),
        duration_minutes: 0,
      });
      setStationLogs([resumed, ...stationLogs]);
      setCurrentTimer(resumed.id);
      toast({ title: 'Work resumed' });
    }
  };

  const inspectLayout = async (decision) => {
    if (!selectedPiece) return;
    const created = await base44.entities.qa_inspections.create({
      piece_id: selectedPiece.id,
      piece_mark: selectedPiece.piece_mark,
      inspector_id: employeeId,
      inspection_stage: 'Layout',
      decision,
      notes: decision === 'Approve Layout' ? 'Approved against PDF' : 'Layout failed - rework required',
    });
    setQaInspections([created, ...qaInspections]);
    const nextStatus = decision === 'Approve Layout' ? 'Ready for Weld' : 'Fabricator Rework';
    await base44.entities.pieces.update(selectedPiece.id, { qa_layout_status: decision === 'Approve Layout' ? 'Approved' : 'Failed', status: nextStatus });
    toast({ title: decision === 'Approve Layout' ? 'Layout approved' : 'Layout failed' });
  };

  const inspectWeld = async () => {
    if (!selectedPiece) return;
    const created = await base44.entities.qa_inspections.create({
      piece_id: selectedPiece.id,
      piece_mark: selectedPiece.piece_mark,
      inspector_id: employeeId,
      inspection_stage: 'Weld',
      decision: 'Approve Welds',
      notes: 'Structural weld profile inspected',
    });
    setQaInspections([created, ...qaInspections]);
    await base44.entities.pieces.update(selectedPiece.id, { qa_weld_status: 'Approved', station_status: 'Paint' });
    toast({ title: 'Weld inspection approved' });
  };

  const pieceLogs = useMemo(() => stationLogs.filter((entry) => entry.piece_id === selectedPiece?.id), [stationLogs, selectedPiece]);

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <PageHeader title="Shop & Fabrication" subtitle="Tablet-friendly production, QR tracking, and QA workflow" />
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="steel-card p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <QrCode className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium">QR / Piece Scan</span>
          </div>
          <div className="flex flex-col gap-2 md:flex-row">
            <Input value={scanValue} onChange={(event) => setScanValue(event.target.value)} placeholder="Scan QR or enter piece mark" />
            <Button onClick={handleScan} className="steel-gradient text-white border-0">Scan</Button>
          </div>
          {selectedPiece ? (
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Active Piece</p>
                  <p className="text-lg font-semibold">{selectedPiece.piece_mark}</p>
                </div>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{selectedPiece.station_status || 'Receiving'}</span>
              </div>
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <div><span className="text-muted-foreground">Assembly</span><p className="font-medium">{selectedPiece.assembly}</p></div>
                <div><span className="text-muted-foreground">Material</span><p className="font-medium">{selectedPiece.material_shape}</p></div>
                <div><span className="text-muted-foreground">Length</span><p className="font-medium">{selectedPiece.length_ft} ft</p></div>
                <div><span className="text-muted-foreground">Grade</span><p className="font-medium">{selectedPiece.material_grade}</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-2" onClick={() => window.open(selectedPiece.drawing_path || '/drawings/PM-100.pdf', '_blank')}><ScanLine className="w-4 h-4" />View Blueprint</Button>
                <Button variant="outline" className="gap-2" onClick={() => logWork('start')}><PlayCircle className="w-4 h-4" />Start Work</Button>
                <Button variant="outline" className="gap-2" onClick={() => logWork('complete')}><CheckCircle2 className="w-4 h-4" />Complete</Button>
                <Button variant="outline" className="gap-2" onClick={() => logWork('pause')}><PauseCircle className="w-4 h-4" />Pause / End Shift</Button>
                {currentTimer ? <Button variant="outline" className="gap-2" onClick={() => logWork('resume')}><PlayCircle className="w-4 h-4" />Resume</Button> : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="steel-card p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <HardHat className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium">Production Station Routing</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {stations.map((station) => (
              <button key={station} onClick={() => setActiveStation(station)} className={`rounded-xl border px-3 py-3 text-left text-sm ${activeStation === station ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>
                {station}
              </button>
            ))}
          </div>
          <div>
            <Label>Employee ID</Label>
            <Input value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="logs">
        <TabsList className="mb-3">
          <TabsTrigger value="logs">Work Logs</TabsTrigger>
          <TabsTrigger value="qa">QA Queue</TabsTrigger>
          <TabsTrigger value="pieces">Pieces</TabsTrigger>
        </TabsList>
        <TabsContent value="logs" className="space-y-3">
          {pieceLogs.map((entry) => (
            <div key={entry.id} className="steel-card p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{entry.station}</span>
                <span className="text-muted-foreground">{entry.status}</span>
              </div>
              <p className="mt-1 text-muted-foreground">Employee {entry.employee_id} • {entry.duration_minutes || 0} min</p>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="qa" className="space-y-3">
          <div className="steel-card p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" onClick={() => inspectLayout('Approve Layout')}><ClipboardCheck className="w-4 h-4" />Approve Layout</Button>
              <Button variant="outline" className="gap-2" onClick={() => inspectLayout('Fail Layout')}><ClipboardCheck className="w-4 h-4" />Fail Layout</Button>
              <Button variant="outline" className="gap-2" onClick={() => inspectWeld()}><CheckCircle2 className="w-4 h-4" />Approve Welds</Button>
            </div>
            {qaInspections.map((inspection) => (
              <div key={inspection.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{inspection.inspection_stage} • {inspection.decision}</p>
                <p className="text-muted-foreground">{inspection.notes}</p>
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="pieces" className="space-y-3">
          {pieces.map((piece) => (
            <div key={piece.id} className="steel-card p-3 text-sm flex items-center justify-between">
              <div>
                <p className="font-medium">{piece.piece_mark}</p>
                <p className="text-muted-foreground">{piece.assembly} • {piece.material_shape}</p>
              </div>
              <div className="text-right">
                <p className="font-medium">{piece.qa_weld_status === 'Approved' ? 'Paint Unlock' : 'QA Pending'}</p>
                <p className="text-muted-foreground">{piece.qr_code}</p>
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
