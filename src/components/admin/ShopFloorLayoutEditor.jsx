import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, TransformControls, Grid, Html, Edges } from '@react-three/drei';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Plus, RotateCw, Trash2, Save } from 'lucide-react';

const ZONE_TYPES = [
  { value: 'indoor_bay', label: 'Indoor Bay' },
  { value: 'outdoor_yard', label: 'Outdoor Yard' },
  { value: 'drive_thru_bay', label: 'Drive-Thru Bay' },
];

const PRESET_COLORS = [
  { name: 'Red (QA)', value: '#ef4444' },
  { name: 'Blue (Paint)', value: '#3b82f6' },
  { name: 'Green (Shipping)', value: '#22c55e' },
  { name: 'Gray (Neutral)', value: '#6b7280' },
  { name: 'Orange (Receiving)', value: '#f97316' },
  { name: 'Purple (Detailing)', value: '#a855f7' },
  { name: 'Teal (Welding)', value: '#14b8a6' },
  { name: 'Yellow (Staging)', value: '#eab308' },
  { name: 'Pink (Inspection)', value: '#ec4899' },
  { name: 'Indigo (Storage)', value: '#6366f1' },
];

const emptyForm = () => ({ label: '', length_ft: 20, width_ft: 20, zone_type: 'indoor_bay' });

function ZoneBox({ zone, selected, onSelect, groupRefs }) {
  return (
    <group
      ref={(el) => { if (el) groupRefs.current[zone.id] = el; }}
      position={[zone.pos_x, zone.height_ft / 2, zone.pos_y]}
      rotation={[0, THREE.MathUtils.degToRad(zone.rotation), 0]}
      onClick={(e) => { e.stopPropagation(); onSelect(zone.id); }}
    >
      <mesh castShadow>
        <boxGeometry args={[zone.width_ft, zone.height_ft, zone.length_ft]} />
        <meshStandardMaterial color={zone.color} transparent opacity={selected ? 0.55 : 0.3} />
        <Edges color={selected ? '#ffffff' : zone.color} />
      </mesh>
      <Html position={[0, zone.height_ft / 2 + 3, 0]} center distanceFactor={40} occlude={false}>
        <div className="px-2 py-1 rounded bg-black/70 text-white text-xs whitespace-nowrap pointer-events-none">
          {zone.label}
        </div>
      </Html>
    </group>
  );
}

function Scene({ zones, selectedId, onSelect, groupRefs, orbitEnabled, setOrbitEnabled, onTransformEnd }) {
  const selectedObject = selectedId ? groupRefs.current[selectedId] : null;

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[40, 60, 30]} intensity={0.9} castShadow />
      <Grid args={[300, 300]} cellSize={5} cellColor="#2a2d35" sectionSize={25} sectionColor="#3a4060" fadeDistance={200} infiniteGrid position={[0, 0, 0]} />
      {zones.map((zone) => (
        <ZoneBox key={zone.id} zone={zone} selected={zone.id === selectedId} onSelect={onSelect} groupRefs={groupRefs} />
      ))}
      {selectedObject && (
        <TransformControls
          object={selectedObject}
          mode="translate"
          showY={false}
          translationSnap={1}
          onMouseDown={() => setOrbitEnabled(false)}
          onMouseUp={() => { setOrbitEnabled(true); onTransformEnd(selectedObject); }}
        />
      )}
      <OrbitControls makeDefault enabled={orbitEnabled} />
    </>
  );
}

export default function ShopFloorLayoutEditor() {
  const { toast } = useToast();
  const [zones, setZones] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [renameValue, setRenameValue] = useState('');
  const [saving, setSaving] = useState(false);
  const groupRefs = useRef({});

  useEffect(() => { loadZones(); }, []);

  const loadZones = async () => {
    try {
      const rows = await db.entities.ShopFloorZone.list('-created_date', 200);
      setZones(rows);
    } catch (e) {}
  };

  const selectedZone = zones.find((z) => z.id === selectedId) || null;

  useEffect(() => {
    setRenameValue(selectedZone?.label || '');
  }, [selectedId]);

  const handleGenerateZone = async () => {
    if (!form.label.trim()) {
      toast({ title: 'Label is required', variant: 'destructive' });
      return;
    }
    try {
      const created = await db.entities.ShopFloorZone.create({
        label: form.label.trim(),
        zone_type: form.zone_type,
        length_ft: Number(form.length_ft) || 20,
        width_ft: Number(form.width_ft) || 20,
        height_ft: 12,
        pos_x: (zones.length % 5) * 25,
        pos_y: Math.floor(zones.length / 5) * 25,
        rotation: 0,
        color: '#3b82f6',
      });
      setZones((prev) => [...prev, created]);
      setForm(emptyForm());
      toast({ title: 'Zone generated' });
    } catch (e) {
      toast({ title: 'Unable to generate zone', variant: 'destructive' });
    }
  };

  const persistZone = async (id, patch) => {
    try {
      const updated = await db.entities.ShopFloorZone.update(id, patch);
      setZones((prev) => prev.map((z) => (z.id === id ? updated : z)));
    } catch (e) {
      toast({ title: 'Unable to save zone', variant: 'destructive' });
    }
  };

  const handleTransformEnd = (object3D) => {
    if (!selectedId) return;
    persistZone(selectedId, { pos_x: Math.round(object3D.position.x), pos_y: Math.round(object3D.position.z) });
  };

  const handleRotate90 = () => {
    if (!selectedZone) return;
    persistZone(selectedZone.id, { rotation: (selectedZone.rotation + 90) % 360 });
  };

  const handleColorChange = (color) => {
    if (!selectedZone) return;
    persistZone(selectedZone.id, { color });
  };

  const handleRenameBlur = () => {
    if (!selectedZone || !renameValue.trim() || renameValue === selectedZone.label) return;
    persistZone(selectedZone.id, { label: renameValue.trim() });
  };

  const handleSaveLayoutConfiguration = async () => {
    setSaving(true);
    try {
      const committed = await Promise.all(
        zones.map((zone) => db.entities.ShopFloorZone.update(zone.id, {
          label: zone.label,
          zone_type: zone.zone_type,
          length_ft: zone.length_ft,
          width_ft: zone.width_ft,
          height_ft: zone.height_ft,
          pos_x: zone.pos_x,
          pos_y: zone.pos_y,
          rotation: zone.rotation,
          color: zone.color,
        }))
      );
      setZones(committed);
      toast({ title: 'Layout configuration saved', description: `${committed.length} zone(s) committed to the 3D inventory map.` });
    } catch (e) {
      toast({ title: 'Unable to save layout configuration', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedZone) return;
    try {
      await db.entities.ShopFloorZone.delete(selectedZone.id);
      delete groupRefs.current[selectedZone.id];
      setZones((prev) => prev.filter((z) => z.id !== selectedZone.id));
      setSelectedId(null);
      toast({ title: 'Zone deleted' });
    } catch (e) {
      toast({ title: 'Unable to delete zone', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">3D Shop Floor Layout Editor</h2>
          <p className="text-sm text-muted-foreground">Create and position facility zones without touching source code. Drag to move, use the panel to rotate, recolor, rename, or delete.</p>
        </div>
        <Button onClick={handleSaveLayoutConfiguration} disabled={saving} className="steel-gradient text-white border-0 flex-shrink-0">
          <Save className="w-4 h-4 mr-2" />{saving ? 'Saving…' : 'Save Layout Configuration'}
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-3 steel-card overflow-hidden relative" style={{ height: '600px' }}>
          <Canvas shadows camera={{ position: [60, 60, 60], fov: 45 }} onPointerMissed={() => setSelectedId(null)}>
            <Scene
              zones={zones}
              selectedId={selectedId}
              onSelect={setSelectedId}
              groupRefs={groupRefs}
              orbitEnabled={orbitEnabled}
              setOrbitEnabled={setOrbitEnabled}
              onTransformEnd={handleTransformEnd}
            />
          </Canvas>
          <div className="absolute bottom-3 right-3 text-xs text-muted-foreground bg-card/80 backdrop-blur rounded px-2 py-1">
            Drag to orbit • Click a zone to select • Drag a selected zone to move
          </div>
        </div>

        <div className="space-y-4">
          <div className="steel-card p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Plus className="w-4 h-4 text-primary" />New Zone</h3>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Label</Label>
                <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} className="mt-1" placeholder="Fab Area 1" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Length (ft)</Label>
                  <Input type="number" value={form.length_ft} onChange={(e) => setForm((f) => ({ ...f, length_ft: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Width (ft)</Label>
                  <Input type="number" value={form.width_ft} onChange={(e) => setForm((f) => ({ ...f, width_ft: e.target.value }))} className="mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={form.zone_type} onValueChange={(v) => setForm((f) => ({ ...f, zone_type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ZONE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleGenerateZone} className="w-full steel-gradient text-white border-0">Generate Zone</Button>
            </div>
          </div>

          {selectedZone && (
            <div className="steel-card p-4">
              <h3 className="font-semibold text-sm mb-3">Selected Zone</h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Label</Label>
                  <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={handleRenameBlur} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Color</Label>
                  <div className="flex flex-wrap gap-2 mt-1 items-center">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c.value}
                        title={c.name}
                        onClick={() => handleColorChange(c.value)}
                        className="w-7 h-7 rounded-full border-2"
                        style={{ backgroundColor: c.value, borderColor: selectedZone.color === c.value ? '#fff' : 'transparent' }}
                      />
                    ))}
                    <input
                      type="color"
                      title="Custom color"
                      value={selectedZone.color || '#3b82f6'}
                      onChange={(e) => handleColorChange(e.target.value)}
                      className="w-7 h-7 rounded-full border-2 border-transparent cursor-pointer bg-transparent p-0"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={handleRotate90}>
                    <RotateCw className="w-3.5 h-3.5 mr-1.5" />Rotate 90°
                  </Button>
                  <Button variant="outline" size="sm" className="text-red-600 border-red-500/30 hover:bg-red-500/10" onClick={handleDelete}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedZone.width_ft}ft × {selectedZone.length_ft}ft · rotation {selectedZone.rotation}° · pos ({selectedZone.pos_x}, {selectedZone.pos_y})
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
