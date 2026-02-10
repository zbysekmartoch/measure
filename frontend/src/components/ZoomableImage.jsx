/**
 * ZoomableImage — scrollable/zoomable container for image display.
 *
 * Controls:
 *   - Mouse wheel to zoom in/out
 *   - Click and drag to pan
 *   - Double-click to reset to fit
 *   - Toolbar with zoom controls and fit button
 *
 * Props:
 *   src  – image URL
 *   alt  – alt text
 */
import React, { useCallback, useRef, useState } from 'react';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.15;

export default function ZoomableImage({ src, alt }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fit, setFit] = useState(true);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setFit(false);
    setZoom((z) => {
      const factor = e.deltaY < 0 ? (1 + ZOOM_STEP) : (1 / (1 + ZOOM_STEP));
      return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor));
    });
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.style.cursor = 'grabbing';
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!dragging.current) return;
    setFit(false);
    setOffset((o) => ({
      x: o.x + (e.clientX - lastPos.current.x),
      y: o.y + (e.clientY - lastPos.current.y),
    }));
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback((e) => {
    dragging.current = false;
    e.currentTarget.style.cursor = 'grab';
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setFit(true);
  }, []);

  const zoomIn = useCallback(() => {
    setFit(false);
    setZoom((z) => Math.min(MAX_ZOOM, z * (1 + ZOOM_STEP)));
  }, []);

  const zoomOut = useCallback(() => {
    setFit(false);
    setZoom((z) => Math.max(MIN_ZOOM, z / (1 + ZOOM_STEP)));
  }, []);

  const pct = Math.round(zoom * 100);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
        background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: 12, flexShrink: 0,
      }}>
        <button onClick={zoomOut} style={tbBtn} title="Zoom out">−</button>
        <span style={{ minWidth: 40, textAlign: 'center', color: '#374151', fontWeight: 500 }}>{pct}%</span>
        <button onClick={zoomIn} style={tbBtn} title="Zoom in">+</button>
        <button onClick={resetView} style={{ ...tbBtn, fontSize: 11, padding: '2px 8px' }} title="Fit to view">Fit</button>
        <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: 11 }}>Scroll to zoom · drag to pan · double-click to reset</span>
      </div>

      {/* Image container */}
      <div
        style={{
          flex: 1, overflow: 'hidden', cursor: 'grab',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f0f0f0',
          backgroundImage: 'linear-gradient(45deg, #e5e5e5 25%, transparent 25%), linear-gradient(-45deg, #e5e5e5 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e5e5 75%), linear-gradient(-45deg, transparent 75%, #e5e5e5 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={resetView}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            ...(fit
              ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
              : { transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: 'center center' }
            ),
            transition: dragging.current ? 'none' : 'transform 0.1s ease-out',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            userSelect: 'none',
          }}
        />
      </div>
    </div>
  );
}

const tbBtn = {
  background: 'none', border: '1px solid #d1d5db', borderRadius: 4,
  padding: '2px 8px', cursor: 'pointer', fontSize: 14, lineHeight: '18px', fontWeight: 600,
};
