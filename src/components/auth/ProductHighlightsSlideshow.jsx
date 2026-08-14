import React, { useCallback, useEffect, useState } from 'react';
import { Calculator, Factory, FolderKanban, HardHat, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';

const AUTO_ADVANCE_MS = 6000;

// Feature highlights for the landing/login page. There are no captured
// product screenshots in this repo yet (see public/ and src/assets/) — each
// slide is an explicitly-labeled illustrative placeholder (icon + gradient)
// rather than something dressed up to look like a real screenshot. A slide
// can instead carry an `image` (URL or data-uri) once a real screenshot
// exists; the fixed aspect-ratio box below means swapping one in later never
// shifts layout.
const DEFAULT_SLIDES = [
  { id: 'estimating', icon: Calculator, title: 'Estimating & Bids', caption: 'Build takeoffs, price bids, and track win/loss — all in one workspace.', accent: 'from-blue-600/40 to-blue-950/70' },
  { id: 'production', icon: Factory, title: 'Shop Floor Production', caption: 'Follow every piece from cut to paint with live station tracking.', accent: 'from-orange-600/40 to-orange-950/70' },
  { id: 'projects', icon: FolderKanban, title: 'Project & Job Cost Management', caption: 'Keep schedule, budget, and change orders visible in one place.', accent: 'from-emerald-600/40 to-emerald-950/70' },
  { id: 'field', icon: HardHat, title: 'Field Operations', caption: 'Manage fleet, rigging, and jobsite logistics from the office or the field.', accent: 'from-amber-600/40 to-amber-950/70' },
  { id: 'quality', icon: ShieldCheck, title: 'Quality & Safety', caption: 'Track certifications, inspections, and QA checklists before they lapse.', accent: 'from-slate-600/40 to-slate-950/70' },
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (e) => setReduced(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}

// Self-contained: auto-advance, pause on hover/focus, manual prev/next,
// clickable dots, arrow-key navigation. No carousel library — embla-carousel
// is already a dependency elsewhere in this app, but it has no built-in
// autoplay plugin installed, and this needs so little Embla actually saves
// (an interval + an index) that hand-rolling it here (same approach already
// proven by LoginVaultBackdrop) avoids pulling in a plugin for one screen.
export default function ProductHighlightsSlideshow({ slides = DEFAULT_SLIDES, className = '' }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const count = slides.length;

  const goNext = useCallback(() => setActiveIndex((i) => (i + 1) % count), [count]);
  const goPrev = useCallback(() => setActiveIndex((i) => (i - 1 + count) % count), [count]);
  const goTo = useCallback((index) => setActiveIndex(((index % count) + count) % count), [count]);

  // Cleared on every unmount AND on every dependency change (incl.
  // activeIndex) — the latter is deliberate: it restarts the countdown
  // whenever the slide changes for any reason, so a manual prev/next/dot
  // click resets the auto-advance clock instead of firing again moments later.
  useEffect(() => {
    if (count < 2 || isPaused || prefersReducedMotion) return;
    const id = setInterval(goNext, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [count, isPaused, prefersReducedMotion, activeIndex, goNext]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
  };

  if (count === 0) return null;
  const slide = slides[activeIndex];

  return (
    <div
      className={`w-full ${className}`}
      role="region"
      aria-roledescription="carousel"
      aria-label="Product highlights"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsPaused(false); }}
      onKeyDown={handleKeyDown}
    >
      <div className="relative aspect-video w-full rounded-xl overflow-hidden border border-white/10 bg-slate-900">
        {slides.map((s, i) => {
          const Icon = s.icon;
          const active = i === activeIndex;
          return (
            <div
              key={s.id}
              className="absolute inset-0 transition-opacity duration-700 ease-in-out"
              style={{ opacity: active ? 1 : 0 }}
              role="group"
              aria-roledescription="slide"
              aria-label={`Slide ${i + 1} of ${count}: ${s.title}`}
              aria-hidden={active ? undefined : true}
            >
              {s.image ? (
                <img src={s.image} alt={s.title} className="absolute inset-0 w-full h-full object-cover" loading={i === 0 ? 'eager' : 'lazy'} />
              ) : (
                <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br ${s.accent}`}>
                  <Icon className="w-14 h-14 text-white/90" aria-hidden="true" />
                  <span className="text-white font-semibold text-lg">{s.title}</span>
                </div>
              )}
            </div>
          );
        })}

        {!slide.image && (
          <span className="absolute top-3 right-3 text-[10px] uppercase tracking-wide font-medium text-white/70 bg-black/40 border border-white/10 rounded-full px-2 py-0.5">
            Illustrative preview
          </span>
        )}

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous slide"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next slide"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {/* Fixed min-height (2 lines at text-sm) so a short caption never
          shrinks the layout relative to a longer, wrapped one. */}
      <p className="mt-3 text-sm text-slate-300 text-center line-clamp-2 min-h-[2.5rem]" title={slide.caption}>
        {slide.caption}
      </p>

      {count > 1 && (
        <div className="mt-2 flex items-center justify-center gap-2">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}: ${s.title}`}
              aria-current={i === activeIndex ? 'true' : undefined}
              className={`h-2 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                i === activeIndex ? 'w-6 bg-white' : 'w-2 bg-white/30 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      )}

      <div aria-live="polite" className="sr-only">{slide.title}: {slide.caption}</div>
    </div>
  );
}
