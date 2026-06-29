import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Info, RotateCcw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ZONES = [
  { id: 'receiving', label: 'Receiving', x: -12, z: -8, w: 6, d: 4, color: 0x3b82f6, description: 'Incoming material receiving area' },
  { id: 'raw_steel', label: 'Raw Steel Storage', x: -4, z: -8, w: 8, d: 4, color: 0x6366f1, description: 'Wide flange, HSS, angles, channels' },
  { id: 'fabrication_a', label: 'Fab Bay A', x: -12, z: -2, w: 6, d: 6, color: 0xf59e0b, description: 'Primary fabrication bay' },
  { id: 'fabrication_b', label: 'Fab Bay B', x: -4, z: -2, w: 6, d: 6, color: 0xf59e0b, description: 'Secondary fabrication bay' },
  { id: 'welding', label: 'Welding', x: 4, z: -2, w: 4, d: 6, color: 0xef4444, description: 'Welding stations' },
  { id: 'paint', label: 'Paint Shop', x: 10, z: -8, w: 6, d: 12, color: 0x8b5cf6, description: 'Blast cleaning and painting' },
  { id: 'qc', label: 'QC / Inspection', x: -4, z: 6, w: 8, d: 4, color: 0x22c55e, description: 'Quality control and inspection area' },
  { id: 'shipping', label: 'Shipping', x: -12, z: 6, w: 6, d: 4, color: 0x14b8a6, description: 'Staged for shipping' },
];

const RACKS = [
  { zone: 'raw_steel', id: 'R-01', x: -6, z: -7, label: 'R-01' },
  { zone: 'raw_steel', id: 'R-02', x: -3, z: -7, label: 'R-02' },
  { zone: 'raw_steel', id: 'R-03', x: 0, z: -7, label: 'R-03' },
  { zone: 'shipping', id: 'S-01', x: -11, z: 7, label: 'S-01' },
  { zone: 'shipping', id: 'S-02', x: -9, z: 7, label: 'S-02' },
];

export default function Warehouse3D({ items = [] }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const frameRef = useRef(null);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const cameraAngle = useRef({ theta: Math.PI / 4, phi: Math.PI / 3 });
  const cameraRadius = useRef(35);

  const [selectedZone, setSelectedZone] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  const getZoneItemCount = (zoneId) => {
    return items.filter(i => i.warehouse_zone === zoneId).length;
  };

  useEffect(() => {
    if (!mountRef.current) return;
    const W = mountRef.current.clientWidth;
    const H = mountRef.current.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1117);
    scene.fog = new THREE.Fog(0x0f1117, 40, 80);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
    cameraRef.current = camera;
    updateCamera();

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x6080ff, 0.3);
    fillLight.position.set(-10, 10, -10);
    scene.add(fillLight);

    // Floor grid
    const floorGeo = new THREE.PlaneGeometry(50, 30);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1d25, roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const gridHelper = new THREE.GridHelper(50, 25, 0x2a2d35, 0x2a2d35);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Warehouse walls outline
    const wallMat = new THREE.LineBasicMaterial({ color: 0x3a4060 });
    const wallPoints = [
      new THREE.Vector3(-15, 0, -10), new THREE.Vector3(16, 0, -10),
      new THREE.Vector3(16, 0, 10), new THREE.Vector3(-15, 0, 10),
      new THREE.Vector3(-15, 0, -10)
    ];
    const wallGeo = new THREE.BufferGeometry().setFromPoints(wallPoints);
    const wallLine = new THREE.Line(wallGeo, wallMat);
    wallLine.position.y = 0.02;
    scene.add(wallLine);

    // Zones
    ZONES.forEach(zone => {
      const itemCount = getZoneItemCount(zone.id);
      const fillRatio = Math.min(itemCount / 10, 1);
      const height = 0.15 + fillRatio * 0.3;

      const geo = new THREE.BoxGeometry(zone.w - 0.2, height, zone.d - 0.2);
      const mat = new THREE.MeshStandardMaterial({
        color: zone.color,
        transparent: true,
        opacity: 0.7,
        roughness: 0.5,
        metalness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(zone.x + zone.w / 2, height / 2, zone.z + zone.d / 2);
      mesh.castShadow = true;
      mesh.userData = { type: 'zone', zoneId: zone.id, label: zone.label, description: zone.description, itemCount };
      scene.add(mesh);

      // Edges
      const edges = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.9 });
      const edgeLines = new THREE.LineSegments(edges, edgeMat);
      edgeLines.position.copy(mesh.position);
      scene.add(edgeLines);

      // Label sprite
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'transparent';
      ctx.clearRect(0, 0, 256, 64);
      ctx.font = 'bold 20px Inter, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(zone.label, 128, 24);
      if (itemCount > 0) {
        ctx.font = '14px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(`${itemCount} items`, 128, 48);
      }
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(zone.x + zone.w / 2, 1.8, zone.z + zone.d / 2);
      sprite.scale.set(4, 1, 1);
      scene.add(sprite);
    });

    // Racks
    RACKS.forEach(rack => {
      const rackGeo = new THREE.BoxGeometry(1.5, 2, 0.5);
      const rackMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.8, metalness: 0.6 });
      const rackMesh = new THREE.Mesh(rackGeo, rackMat);
      rackMesh.position.set(rack.x, 1, rack.z);
      rackMesh.castShadow = true;
      rackMesh.userData = { type: 'rack', rackId: rack.id, label: rack.label };
      scene.add(rackMesh);

      // Rack shelves
      for (let shelf = 0; shelf < 3; shelf++) {
        const shelfGeo = new THREE.BoxGeometry(1.5, 0.05, 0.5);
        const shelfMat = new THREE.MeshStandardMaterial({ color: 0x718096 });
        const shelfMesh = new THREE.Mesh(shelfGeo, shelfMat);
        shelfMesh.position.set(rack.x, 0.3 + shelf * 0.7, rack.z);
        scene.add(shelfMesh);
      }
    });

    // Raycaster for click
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (e) => {
      if (!mountRef.current) return;
      const rect = mountRef.current.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / W) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / H) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, false);
      const hit = intersects.find(i => i.object.userData?.type);
      if (hit) {
        const zone = ZONES.find(z => z.id === hit.object.userData.zoneId);
        if (zone) setSelectedZone({ ...zone, itemCount: hit.object.userData.itemCount });
      } else {
        setSelectedZone(null);
      }
    };

    // Mouse drag for orbit
    const onMouseDown = (e) => {
      isDragging.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = () => { isDragging.current = false; };
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      cameraAngle.current.theta -= dx * 0.005;
      cameraAngle.current.phi = Math.max(0.3, Math.min(Math.PI / 2, cameraAngle.current.phi + dy * 0.005));
      lastMouse.current = { x: e.clientX, y: e.clientY };
      updateCamera();
    };
    const onWheel = (e) => {
      cameraRadius.current = Math.max(10, Math.min(60, cameraRadius.current + e.deltaY * 0.05));
      updateCamera();
    };

    renderer.domElement.addEventListener('click', handleClick);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true });

    // Animation
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Resize
    const handleResize = () => {
      if (!mountRef.current) return;
      const W2 = mountRef.current.clientWidth;
      const H2 = mountRef.current.clientHeight;
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
      renderer.setSize(W2, H2);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [items]);

  function updateCamera() {
    if (!cameraRef.current) return;
    const { theta, phi } = cameraAngle.current;
    const r = cameraRadius.current;
    cameraRef.current.position.set(
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.cos(theta)
    );
    cameraRef.current.lookAt(0, 0, 0);
  }

  const resetCamera = () => {
    cameraAngle.current = { theta: Math.PI / 4, phi: Math.PI / 3 };
    cameraRadius.current = 35;
    updateCamera();
  };

  return (
    <div className="steel-card overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h3 className="font-semibold">3D Warehouse View</h3>
          <p className="text-xs text-muted-foreground">Click zones to inspect • Drag to rotate • Scroll to zoom</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={resetCamera}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset View
          </Button>
        </div>
      </div>

      <div className="relative" style={{ height: '520px' }}>
        <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

        {/* Zone Legend */}
        <div className="absolute top-4 left-4 bg-card/90 backdrop-blur border border-border rounded-lg p-3 space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Zones</p>
          {ZONES.slice(0, 6).map(zone => (
            <div key={zone.id} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: `#${zone.color.toString(16).padStart(6, '0')}` }} />
              <span className="text-xs text-foreground/80">{zone.label}</span>
            </div>
          ))}
        </div>

        {/* Selected Zone Info */}
        {selectedZone && (
          <div className="absolute top-4 right-4 bg-card/95 backdrop-blur border border-border rounded-lg p-4 w-64 animate-fade-in">
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-semibold text-sm">{selectedZone.label}</h4>
              <button onClick={() => setSelectedZone(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">{selectedZone.description}</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted rounded p-2">
                <p className="text-xs text-muted-foreground">Items</p>
                <p className="text-sm font-bold">{selectedZone.itemCount}</p>
              </div>
              <div className="bg-muted rounded p-2">
                <p className="text-xs text-muted-foreground">Zone ID</p>
                <p className="text-sm font-bold font-mono">{selectedZone.id.toUpperCase().replace('_','-')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Controls hint */}
        <div className="absolute bottom-4 right-4 text-xs text-muted-foreground bg-card/80 backdrop-blur rounded px-2 py-1">
          🖱 Drag to orbit • Scroll to zoom • Click zone for details
        </div>
      </div>

      {/* Zone Summary Table */}
      <div className="p-4 border-t border-border">
        <h4 className="text-sm font-semibold mb-3">Zone Summary</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {ZONES.map(zone => {
            const count = getZoneItemCount(zone.id);
            return (
              <div
                key={zone.id}
                onClick={() => setSelectedZone({ ...zone, itemCount: count })}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors"
              >
                <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: `#${zone.color.toString(16).padStart(6, '0')}` }} />
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{zone.label}</p>
                  <p className="text-xs text-muted-foreground">{count} items</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}