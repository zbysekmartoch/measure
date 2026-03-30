/**
 * DataExplorerTab — top-level tab for interactive data analysis with Perspective.
 *
 * Props:
 *   source — { labId, apiPath, fileName }
 *            apiPath  = full API path to the file's parent (e.g. /api/v1/labs/3/results/run-1/files)
 *            fileName = file name (e.g. output.csv)
 */
import React, { useState, useEffect, Suspense } from 'react';
import { fetchJSON } from '../lib/fetchJSON.js';
import { shadow } from '../lib/uiConfig.js';

const PerspectiveViewer = React.lazy(
  () => import('../components/PerspectiveViewer.jsx')
);

/** Error boundary — catch Perspective crashes without taking down the whole app */
class PerspectiveErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#dc2626', padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>❌ Data Explorer failed to load</div>
          <pre style={{ fontSize: 12, color: '#6b7280', maxWidth: '80%', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ padding: '6px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
          >
            ↻ Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DataExplorerTab({ source }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!source) return;

    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchJSON(
          `${source.apiPath}/content?file=${encodeURIComponent(source.fileName)}`
        );
        if (!cancelled) {
          setData(res.content);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [source]);

  const handleExportCsv = async () => {
    // Access the perspective-viewer element inside the lazy-loaded wrapper
    const viewer = document.querySelector('perspective-viewer');
    if (!viewer) return;
    try {
      const view = viewer.querySelector('perspective-viewer') || viewer;
      const table = await view.getTable();
      const v = await table.view();
      const csv = await v.to_csv();
      v.delete();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analyzed_${source.fileName}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: export the original data
      if (data) {
        const blob = new Blob([data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = source.fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center',
                     justifyContent: 'center', color: '#6b7280', fontSize: 14 }}>
        ⏳ Loading data…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center',
                     justifyContent: 'center', color: '#dc2626', fontSize: 14 }}>
        ❌ {error}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
        borderBottom: '1px solid #e5e7eb', background: '#f9fafb', flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
          � {source.fileName}
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          Lab #{source.labId}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={handleExportCsv}
            style={{
              padding: '4px 10px', background: '#2f9722', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              fontSize: 12, boxShadow: shadow.small,
            }}
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Perspective Viewer — lazy loaded */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <PerspectiveErrorBoundary>
          <Suspense fallback={
            <div style={{ height: '100%', display: 'flex', alignItems: 'center',
                           justifyContent: 'center', color: '#6b7280' }}>
              Loading Data Explorer…
            </div>
          }>
            <PerspectiveViewer data={data} fileName={source.fileName} />
          </Suspense>
        </PerspectiveErrorBoundary>
      </div>
    </div>
  );
}
