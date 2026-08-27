import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { AlertTriangle, X } from 'lucide-react';

let scannerInstanceCounter = 0;

// Detects a touch-primary device (phone, or a tablet regardless of screen
// width) so scan surfaces can make the camera button the prominent option
// there while keeping the handheld-scanner text input primary on a
// desktop/kiosk terminal — see CameraQrScanner.jsx's role in
// ShopFabrication.jsx/ShopFloorCommandCenter.jsx/JobsiteReceiving.jsx/
// YardScanning.jsx. `pointer: coarse` catches tablets that are wide enough
// to miss a narrow max-width check.
export function useIsTouchPrimaryDevice() {
  const [touchPrimary, setTouchPrimary] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia('(pointer: coarse), (max-width: 768px)');
    const update = () => setTouchPrimary(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return touchPrimary;
}

const QR_BOX = { width: 250, height: 250 };

// Shared camera-based QR scanner — a third input method alongside the
// handheld-scanner text field and manual piece-mark entry every shop-floor
// scan surface already has. Camera access is only ever requested once this
// component actually mounts (i.e. the caller opened it from an explicit
// button press), never on page load. Decoded text is handed back via
// onScan and MUST be run through the same matchPieceByScan()/handleScan()
// resolution logic the caller's own text input already uses — this
// component only produces a string, it never matches pieces itself.
export default function CameraQrScanner({ onScan, onCancel }) {
  const [elementId] = useState(() => `camera-qr-scanner-${++scannerInstanceCounter}`);
  const scannerRef = useRef(null);
  const hasScannedRef = useRef(false);
  const [status, setStatus] = useState('starting'); // starting | scanning | denied | unavailable

  const stopScanner = async () => {
    const instance = scannerRef.current;
    scannerRef.current = null;
    if (!instance) return;
    try {
      if (instance.isScanning) await instance.stop();
      instance.clear();
    } catch (e) {
      // camera/track may already be torn down (fast cancel, unmount race) —
      // nothing left to clean up either way
    }
  };

  useEffect(() => {
    let cancelled = false;
    hasScannedRef.current = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setStatus('unavailable');
        return;
      }
      let instance;
      try {
        instance = new Html5Qrcode(elementId, { verbose: false });
        scannerRef.current = instance;
        await instance.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: QR_BOX },
          (decodedText) => {
            if (hasScannedRef.current) return;
            hasScannedRef.current = true;
            stopScanner().finally(() => onScan(decodedText));
          },
          () => {} // per-frame "no code visible yet" — expected constantly, not an error to surface
        );
        if (!cancelled) setStatus('scanning');
      } catch (err) {
        if (cancelled) return;
        const name = err?.name || '';
        setStatus(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' : 'unavailable');
      }
    };

    start();

    return () => {
      cancelled = true;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId]);

  const handleCancel = async () => {
    await stopScanner();
    onCancel();
  };

  const errorMessage = status === 'denied'
    ? 'Camera access was denied. Allow camera access in your browser settings, or enter the piece mark manually instead.'
    : 'No usable camera was found on this device. Enter the piece mark manually instead.';

  return (
    <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between text-white">
          <p className="text-sm font-medium">Scan QR Code</p>
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={handleCancel}>
            <X className="w-4 h-4 mr-1" />Cancel
          </Button>
        </div>

        {(status === 'denied' || status === 'unavailable') ? (
          <div className="rounded-xl bg-neutral-900 border border-neutral-700 p-6 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-yellow-500 mx-auto" />
            <p className="text-sm text-white">{errorMessage}</p>
            <Button variant="outline" className="w-full" onClick={handleCancel}>Enter Manually Instead</Button>
          </div>
        ) : (
          <>
            <div className="rounded-xl overflow-hidden bg-black border border-neutral-700 [&_video]:w-full [&_video]:h-auto">
              <div id={elementId} />
            </div>
            <p className="text-xs text-center text-neutral-400">
              {status === 'starting' ? 'Requesting camera access…' : 'Position the QR code inside the frame.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
