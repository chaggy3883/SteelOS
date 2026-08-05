import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';

const ROTATE_MS = 7000;

// Renders whatever the Super Admin has uploaded in the Login Vault Slideshow
// manager (db.entities.login_slideshow_images) as a slow-zooming,
// cross-fading backdrop. Falls back to a plain dark gradient when nothing's
// been uploaded yet — never a broken image, never a hardcoded external URL.
export default function LoginVaultBackdrop() {
  const [images, setImages] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    db.entities.login_slideshow_images.list('display_order', 20)
      .then(setImages)
      .catch(() => setImages([]));
  }, []);

  useEffect(() => {
    if (images.length < 2) return;
    const id = setInterval(() => {
      setActiveIndex((i) => (i + 1) % images.length);
      setCycle((c) => c + 1);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [images.length]);

  if (images.length === 0) {
    return <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-black" />;
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-950">
      {images.map((img, i) => (
        <div
          key={img.id}
          className="absolute inset-0 transition-opacity ease-in-out"
          style={{ opacity: i === activeIndex ? 1 : 0, transitionDuration: '1500ms' }}
        >
          {i === activeIndex && (
            <div
              key={`${img.id}-${cycle}`}
              className="absolute inset-0 bg-cover bg-center bg-no-repeat bg-slate-950 transition-all duration-1000 login-vault-ken-burns"
              style={{ backgroundImage: `url(${img.image_data_uri})` }}
            />
          )}
        </div>
      ))}
      <div className="absolute inset-0 bg-black/55" />
    </div>
  );
}
