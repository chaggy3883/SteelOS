import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Ruler, Spline, Pentagon, Shapes, Box, BrickWall, TriangleRight, Radius, Diameter, Magnet,
} from 'lucide-react';
import { MEASURE_TOOLS } from '@/lib/takeoffGeometry';

const ICONS = {
  length: Ruler,
  polylength: Spline,
  perimeter: Pentagon,
  area: Shapes,
  volume: Box,
  wall_area: BrickWall,
  angle: TriangleRight,
  radius: Radius,
  diameter: Diameter,
};

// The drawn measuring tools (everything except Count/Bolt Count, which keep
// their own setup-first buttons), plus the snap toggle and — while a circle
// tool is live — how the circle gets picked.
export default function MeasureToolButtons({ activeTool, onActivate, disabled, snapEnabled, onToggleSnap, circleMode, onCircleMode }) {
  const isCircle = MEASURE_TOOLS[activeTool]?.input === 'circle';
  return (
    <>
      {Object.entries(MEASURE_TOOLS).map(([id, def]) => {
        const Icon = ICONS[id] || Ruler;
        return (
          <Button
            key={id}
            size="sm"
            variant={activeTool === id ? 'default' : 'ghost'}
            onClick={() => onActivate(id)}
            disabled={disabled}
            title={def.hint}
          >
            <Icon className="w-3.5 h-3.5 mr-1.5" />{def.label}
          </Button>
        );
      })}
      {isCircle && (
        <div className="flex items-center gap-0.5 rounded-md border px-1 py-0.5 text-xs">
          <button type="button" className={`px-1.5 py-0.5 rounded ${circleMode !== 'three' ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => onCircleMode('center')}>Center + edge</button>
          <button type="button" className={`px-1.5 py-0.5 rounded ${circleMode === 'three' ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => onCircleMode('three')}>3 points</button>
        </div>
      )}
      <Button
        size="sm"
        variant={snapEnabled ? 'default' : 'ghost'}
        onClick={onToggleSnap}
        title={snapEnabled ? 'Snapping to drawing lines is on — hold Alt to place a point freely' : 'Snap to drawing lines is off'}
      >
        <Magnet className="w-3.5 h-3.5 mr-1.5" />Snap {snapEnabled ? 'On' : 'Off'}
      </Button>
    </>
  );
}
