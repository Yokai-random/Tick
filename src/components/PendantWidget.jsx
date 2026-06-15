import React, { useRef, useEffect, useState, useCallback } from 'react';

import imgTotem       from '../assets/pendants/totem.png';
import imgHeart       from '../assets/pendants/heart.png';
import imgNetherStar  from '../assets/pendants/netherstar.png';
import imgGoldenApple from '../assets/pendants/goldenapple.png';
import imgDiamond     from '../assets/pendants/diamond.png';
import imgChain       from '../assets/pendants/chain.png';

// ── Physics constants ─────────────────────────────────────────────────────────
const G_L            = 4;
const DAMP           = 0.28;
const STOP_EPS       = 0.004;
const MAX_ANG        = Math.PI * 0.72;
const MAX_VEL        = 8;
const VELOCITY_SCALE = 20000;

// ── Sizing ────────────────────────────────────────────────────────────────────
// chain.png natural size: 177 × 688
const CHAIN_W       = 20;                                    // display width px
const CHAIN_H       = Math.round(CHAIN_W * 688 / 177);      // ≈ 78 px (exact ratio)
const CHAIN_OVERLAP = 8;   // pendant top overlaps chain bottom by this many px
const PENDANT_SIZE  = 60;  // px, uniform for all icons

// ── Presets ───────────────────────────────────────────────────────────────────
const PRESETS = [
  { key: 'totem',       img: imgTotem,       name: '不死图腾' },
  { key: 'heart',       img: imgHeart,       name: '红心'     },
  { key: 'netherstar',  img: imgNetherStar,  name: '下界之星' },
  { key: 'goldenapple', img: imgGoldenApple, name: '金苹果'   },
  { key: 'diamond',     img: imgDiamond,     name: '钻石'     },
];

// ── Keyring top: clasp + ring only (chain replaces the SVG chain links) ───────
function KeyringTop({ dark }) {
  const gold   = dark ? '#D4AC44' : '#C09830';
  const shine  = 'rgba(255,248,210,0.48)';
  const shadow = dark ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0.20)';
  return (
    // viewBox ends just below ring bottom (y=26) with a 2px stub toward chain
    <svg viewBox="0 0 36 29" width="36" height="29">
      {/* Clasp / attachment stub */}
      <rect x="14" y="0" width="8" height="6" rx="3"
        fill={gold} stroke={shadow} strokeWidth="0.5"/>
      <rect x="15" y="0.5" width="6" height="3" rx="2"
        fill={shine} opacity="0.6"/>

      {/* Main keyring circle */}
      <circle cx="18" cy="16" r="10"
        fill="none" stroke={gold} strokeWidth="3"/>
      <path d="M18 26 A10 10 0 0 0 28 16"
        fill="none" stroke={shadow} strokeWidth="1.2" opacity="0.5"
        strokeLinecap="round"/>
      <path d="M18 6 A10 10 0 0 1 28 16"
        fill="none" stroke={shine} strokeWidth="1.8"
        strokeLinecap="round"/>

      {/* Short stub connecting ring bottom to chain top */}
      <line x1="18" y1="26" x2="18" y2="29"
        stroke={gold} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PendantWidget() {
  // ── Theme detection ───────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark',
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.getAttribute('data-theme') === 'dark'),
    );
    obs.observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme'],
    });
    return () => obs.disconnect();
  }, []);

  // ── Preset cycling ────────────────────────────────────────────────────────
  const [presetIdx, setPresetIdx] = useState(0);

  // ── Physics refs ──────────────────────────────────────────────────────────
  const [dispAngle, setDispAngle] = useState(0);
  const angleRef  = useRef(0);
  const angVelRef = useRef(0);
  const rafRef    = useRef(null);
  const lastTRef  = useRef(null);
  const loopFnRef = useRef(null);

  // ── RAF physics loop ──────────────────────────────────────────────────────
  useEffect(() => {
    loopFnRef.current = (t) => {
      const dt = lastTRef.current
        ? Math.min((t - lastTRef.current) / 1000, 0.05)
        : 0.016;
      lastTRef.current = t;

      let a = angleRef.current;
      let v = angVelRef.current;

      if (Math.abs(a) < STOP_EPS && Math.abs(v) < STOP_EPS) {
        angleRef.current = 0; angVelRef.current = 0;
        setDispAngle(0);
        rafRef.current = null;
        return;
      }

      const acc = -G_L * Math.sin(a) - DAMP * v;
      v += acc * dt;
      a += v * dt;
      a = Math.max(-MAX_ANG, Math.min(MAX_ANG, a));

      angleRef.current  = a;
      angVelRef.current = v;
      setDispAngle(a);
      rafRef.current = requestAnimationFrame(loopFnRef.current);
    };

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const startAnim = useCallback(() => {
    if (rafRef.current || !loopFnRef.current) return;
    lastTRef.current = null;
    rafRef.current = requestAnimationFrame(loopFnRef.current);
  }, []);

  // ── Window-move inertia ───────────────────────────────────────────────────
  useEffect(() => {
    if (!window.cmcl?.onWindowMoved) return;
    const unsub = window.cmcl.onWindowMoved(({ vx }) => {
      const impulse = -(vx / VELOCITY_SCALE);
      angVelRef.current = Math.max(-MAX_VEL,
        Math.min(MAX_VEL, angVelRef.current + impulse));
      startAnim();
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [startAnim]);

  // ── Click: cycle pendant ──────────────────────────────────────────────────
  const handleClick = useCallback((e) => {
    e.stopPropagation();
    setPresetIdx(i => (i + 1) % PRESETS.length);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  const preset = PRESETS[presetIdx];

  const ringShadow = isDark
    ? 'drop-shadow(0 2px 8px rgba(0,0,0,0.65)) drop-shadow(0 0 4px rgba(200,160,50,0.25))'
    : 'drop-shadow(0 2px 5px rgba(0,0,0,0.28))';
  const pdShadow = isDark
    ? 'drop-shadow(0 3px 8px rgba(0,0,0,0.65))'
    : 'drop-shadow(0 2px 5px rgba(0,0,0,0.26))';

  return (
    // Fixed anchor, pointer-events off so background stays clickable
    <div style={{
      position: 'fixed', right: 28, bottom: 0, zIndex: 50,
      width: 60, display: 'flex', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      {/*
        Single rigid-body assembly — everything rotates together around the
        top-centre pivot (the clasp that attaches to the title bar).
      */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        transformOrigin: 'top center',
        transform: `rotate(${dispAngle}rad)`,
        willChange: 'transform',
        paddingBottom: 14,
      }}>

        {/* ── Keyring: clasp + ring ── */}
        <div style={{ filter: ringShadow }}>
          <KeyringTop dark={isDark} />
        </div>

        {/* ── Chain image — hangs straight below ring stub ── */}
        <img
          src={imgChain}
          alt=""
          aria-hidden="true"
          className="pixel-img"
          draggable={false}
          style={{
            display: 'block',
            width: CHAIN_W,
            height: CHAIN_H,
            objectFit: 'fill',   // exact dimensions match the source aspect ratio
            filter: pdShadow,
          }}
        />

        {/* ── Pendant — overlaps chain bottom by CHAIN_OVERLAP px ── */}
        <div
          onClick={handleClick}
          title={`${preset.name} · 点击切换造型`}
          style={{
            pointerEvents: 'all',
            cursor: 'pointer',
            userSelect: 'none',
            filter: pdShadow,
            marginTop: -CHAIN_OVERLAP,
          }}
        >
          <img
            src={preset.img}
            alt={preset.name}
            className="pixel-img"
            draggable={false}
            style={{
              display: 'block',
              width: PENDANT_SIZE,
              height: PENDANT_SIZE,
              objectFit: 'contain',
            }}
          />
        </div>

      </div>
    </div>
  );
}
