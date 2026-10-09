import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { fetchJSON } from '../lib/fetchJSON.js';
import { getPageLoads, clearPageLoads, explainPageLoad } from '../lib/uiSession.js';

const STREAM_INTERVAL_MS = 2000;
const HISTORY_SIZE = 90;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pushSample(arr, value) {
  const next = [...arr, Number.isFinite(value) ? value : 0];
  if (next.length > HISTORY_SIZE) next.shift();
  return next;
}

function formatMb(mb) {
  const v = Number(mb);
  if (!Number.isFinite(v)) return '-';
  return v >= 1024 ? `${(v / 1024).toFixed(2)} GB` : `${Math.round(v)} MB`;
}

function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function SparkChart({ title, value, data, color }) {
  const width = 420;
  const height = 120;
  const axisWidth = 36;
  const chartWidth = width - axisWidth;
  const safeData = data.length > 0 ? data : [0];
  const max = Math.max(1, ...safeData);
  const min = Math.min(...safeData);

  const linePoints = safeData
    .map((v, i) => {
      const x = axisWidth + (safeData.length > 1 ? (i / (safeData.length - 1)) * chartWidth : chartWidth);
      const y = height - ((v / max) * (height - 8)) - 4;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPath = safeData
    .map((v, i) => {
      const x = axisWidth + (safeData.length > 1 ? (i / (safeData.length - 1)) * chartWidth : chartWidth);
      const y = height - ((v / max) * (height - 8)) - 4;
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ') + ` L ${width} ${height} L ${axisWidth} ${height} Z`;

  return (
    <div style={{
      border: '1px solid #1f2937',
      borderRadius: 8,
      overflow: 'hidden',
      background: '#0f172a',
      minHeight: 170,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '10px 12px 0',
        color: '#e5e7eb',
        fontSize: 13,
      }}>
        <strong style={{ fontWeight: 600 }}>{title}</strong>
        <span style={{ fontSize: 16, color, textAlign: 'right' }}>
          {value}
          <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af' }}>
            min {formatNumber(min, 1)} / max {formatNumber(max, 1)}
          </span>
        </span>
      </div>

      <div style={{ padding: '6px 10px 10px', flex: 1 }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="120" preserveAspectRatio="none" aria-hidden="true">
          <line x1={axisWidth} y1="0" x2={axisWidth} y2={height} stroke="#334155" strokeWidth="1" />

          {[0, 0.5, 1].map((ratio) => {
            const y = height - (ratio * (height - 8)) - 4;
            const label = ratio === 0 ? 0 : ratio === 0.5 ? max / 2 : max;
            return (
              <g key={ratio}>
                <line x1={axisWidth - 4} y1={y} x2={axisWidth} y2={y} stroke="#64748b" strokeWidth="1" />
                <text x={axisWidth - 6} y={y + 3} fill="#94a3b8" fontSize="9" textAnchor="end">
                  {formatNumber(label, label < 10 ? 1 : 0)}
                </text>
              </g>
            );
          })}

          {[0.25, 0.5, 0.75].map((ratio) => {
            const y = height * ratio;
            return (
              <line
                key={ratio}
                x1={axisWidth}
                y1={y}
                x2={width}
                y2={y}
                stroke="#1f2937"
                strokeWidth="1"
              />
            );
          })}

          <path d={areaPath} fill={color} opacity="0.18" />
          <polyline
            points={linePoints}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

function PercentUsageChart({ title, subtitle, value, data, color }) {
  const width = 420;
  const height = 120;
  const axisWidth = 36;
  const chartWidth = width - axisWidth;
  const safeData = (data.length > 0 ? data : [0]).map((v) => clamp(Number(v) || 0, 0, 100));

  const linePoints = safeData
    .map((v, i) => {
      const x = axisWidth + (safeData.length > 1 ? (i / (safeData.length - 1)) * chartWidth : chartWidth);
      const y = height - (((v - 0) / 100) * (height - 8)) - 4;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPath = safeData
    .map((v, i) => {
      const x = axisWidth + (safeData.length > 1 ? (i / (safeData.length - 1)) * chartWidth : chartWidth);
      const y = height - (((v - 0) / 100) * (height - 8)) - 4;
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ') + ` L ${width} ${height} L ${axisWidth} ${height} Z`;

  return (
    <div style={{
      border: '1px solid #1f2937',
      borderRadius: 8,
      overflow: 'hidden',
      background: '#0f172a',
      minHeight: 170,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '10px 12px 0',
        color: '#e5e7eb',
        fontSize: 13,
      }}>
        <strong style={{ fontWeight: 600 }}>{title}</strong>
        <span style={{ fontSize: 16, color, textAlign: 'right' }}>{value}</span>
      </div>

      <div style={{ padding: '2px 12px 0', color: '#94a3b8', fontSize: 11 }}>{subtitle}</div>

      <div style={{ padding: '6px 10px 10px', flex: 1 }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="120" preserveAspectRatio="none" aria-hidden="true">
          <line x1={axisWidth} y1="0" x2={axisWidth} y2={height} stroke="#334155" strokeWidth="1" />

          {[0, 50, 100].map((label) => {
            const y = height - ((label / 100) * (height - 8)) - 4;
            return (
              <g key={label}>
                <line x1={axisWidth - 4} y1={y} x2={axisWidth} y2={y} stroke="#64748b" strokeWidth="1" />
                <text x={axisWidth - 6} y={y + 3} fill="#94a3b8" fontSize="9" textAnchor="end">
                  {label}
                </text>
              </g>
            );
          })}

          {[0.25, 0.5, 0.75].map((ratio) => {
            const y = height * ratio;
            return (
              <line
                key={ratio}
                x1={axisWidth}
                y1={y}
                x2={width}
                y2={y}
                stroke="#1f2937"
                strokeWidth="1"
              />
            );
          })}

          <path d={areaPath} fill={color} opacity="0.18" />
          <polyline
            points={linePoints}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, valueNode }) {
  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      padding: 12,
      background: '#fff',
      minHeight: 86,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{title}</div>
      {valueNode || (
        <div style={{ fontSize: 22, lineHeight: 1.1, color: '#111827', fontWeight: 700 }}>{value}</div>
      )}
      <div style={{ fontSize: 11, color: '#9ca3af' }}>{subtitle}</div>
    </div>
  );
}

export default function PerformanceTab() {
  const { t } = useLanguage();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [streamState, setStreamState] = useState('off');
  const streamRef = useRef(null);
  const [showRequestDetails, setShowRequestDetails] = useState(false);
  const [requestDetails, setRequestDetails] = useState([]);
  const [requestDetailsMeta, setRequestDetailsMeta] = useState({ totalObserved: 0, buffered: 0 });
  const [requestDetailsLoading, setRequestDetailsLoading] = useState(false);
  const [requestDetailsError, setRequestDetailsError] = useState('');
  const [usageHistoryByKey, setUsageHistoryByKey] = useState({});
  const [pageLoads, setPageLoads] = useState(() => getPageLoads());
  const [history, setHistory] = useState({
    activeUsers: [],
    requestsPerMinute: [],
    rateLimitedPerMinute: [],
    errors5xxPerMinute: [],
    inFlight: [],
    avgLatencyMs1m: [],
    cpuPercent: [],
    rssMb: [],
    systemMemPercent: [],
    systemAvailableMb: [],
  });

  const loadRequestDetails = useRef(async () => {
    setRequestDetailsLoading(true);
    try {
      const data = await fetchJSON('/api/v1/performance/requests?limit=200');
      setRequestDetails(Array.isArray(data?.items) ? data.items : []);
      setRequestDetailsMeta({
        totalObserved: Number(data?.totalObserved || 0),
        buffered: Number(data?.buffered || 0),
      });
      setRequestDetailsError('');
    } catch (e) {
      setRequestDetailsError(e?.message || 'Failed to load request details.');
    } finally {
      setRequestDetailsLoading(false);
    }
  });

  useEffect(() => {
    if (!monitorEnabled) {
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
      setStreamState('off');
      return undefined;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
      setError('Missing auth token for performance stream.');
      setStreamState('error');
      return undefined;
    }

    const url = `/api/v1/performance/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    streamRef.current = es;
    setStreamState('connecting');
    setError('');

    const onStats = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        setStats(data);
        setLastUpdatedAt(new Date());
        setStreamState('live');
        setError('');

        setHistory((prev) => ({
          activeUsers: pushSample(prev.activeUsers, data.users?.activeAuthenticated || 0),
          requestsPerMinute: pushSample(prev.requestsPerMinute, data.requests?.perMinute || 0),
          rateLimitedPerMinute: pushSample(prev.rateLimitedPerMinute, data.requests?.rateLimitedPerMinute || 0),
          errors5xxPerMinute: pushSample(prev.errors5xxPerMinute, data.requests?.errors5xxPerMinute || 0),
          inFlight: pushSample(prev.inFlight, data.requests?.inFlight || 0),
          avgLatencyMs1m: pushSample(prev.avgLatencyMs1m, data.latency?.avgMs1m || 0),
          cpuPercent: pushSample(prev.cpuPercent, data.runtime?.cpuPercent || 0),
          rssMb: pushSample(prev.rssMb, data.runtime?.rssMb || 0),
          systemMemPercent: pushSample(prev.systemMemPercent, data.system?.memUsedPercent || 0),
          systemAvailableMb: pushSample(prev.systemAvailableMb, data.system?.memAvailableMb || 0),
        }));

        const keyUsageItems = Array.isArray(data?.requests?.apiKeyUsage) ? data.requests.apiKeyUsage : [];
        setUsageHistoryByKey((prev) => {
          const next = {};
          keyUsageItems.forEach((item) => {
            const key = String(item?.key || '');
            if (!key) return;
            next[key] = pushSample(prev[key] || [], Number(item?.usagePercent || 0));
          });
          return next;
        });
      } catch {
        setStreamState('error');
        setError('Failed to parse performance stream payload.');
      }
    };

    es.addEventListener('stats', onStats);
    es.onmessage = onStats;
    es.onerror = () => {
      setStreamState('error');
      setError('Performance stream disconnected. Toggle monitor off/on to reconnect.');
    };

    return () => {
      es.removeEventListener('stats', onStats);
      es.close();
      if (streamRef.current === es) {
        streamRef.current = null;
      }
    };
  }, [monitorEnabled]);

  useEffect(() => {
    if (!showRequestDetails) return undefined;

    loadRequestDetails.current();

    const interval = setInterval(() => {
      loadRequestDetails.current();
    }, monitorEnabled ? 4000 : 8000);

    return () => clearInterval(interval);
  }, [showRequestDetails, monitorEnabled]);

  const statusTotals = useMemo(() => {
    return stats?.requests?.statusTotals || {
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0,
      '429': 0,
    };
  }, [stats]);

  const requestLimits = useMemo(() => {
    return stats?.requestLimits || {
      jsonBodyLimit: '1mb',
      auth: { windowMs: 60_000, maxPerIp: 40 },
      api: { windowMs: 60_000, maxPerKey: 1200 },
    };
  }, [stats]);

  const apiKeyUsageItems = useMemo(() => {
    return Array.isArray(stats?.requests?.apiKeyUsage) ? stats.requests.apiKeyUsage : [];
  }, [stats]);

  const systemMem = stats?.system || null;
  const memUsedPercent = clamp(Number(systemMem?.memUsedPercent || 0), 0, 100);
  const memColor = memUsedPercent >= 90 ? '#ef4444' : memUsedPercent >= 75 ? '#f59e0b' : '#22c55e';
  const workflows = Array.isArray(stats?.workflows) ? stats.workflows : [];
  const WORKFLOW_STATUS_COLORS = {
    running: '#1d4ed8',
    waiting: '#b45309',
    'debug-waiting': '#b45309',
    'debug-stopped': '#dc2626',
    completed: '#16a34a',
    failed: '#dc2626',
    aborted: '#92400e',
  };

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ margin: 0, color: '#111827' }}>{t('tabPerformance') || 'Performance'}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => setMonitorEnabled((v) => !v)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #0f172a',
              background: monitorEnabled ? '#0f172a' : '#fff',
              color: monitorEnabled ? '#f8fafc' : '#0f172a',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            {monitorEnabled ? 'Stop monitoring' : 'Monitor performance'}
          </button>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {monitorEnabled
              ? (lastUpdatedAt
                ? `SSE ${streamState} • ~${STREAM_INTERVAL_MS / 1000}s • ${lastUpdatedAt.toLocaleTimeString()}`
                : `SSE ${streamState} • waiting for first sample...`)
              : 'Monitoring is OFF'}
          </span>
        </div>
      </div>

      {!monitorEnabled && (
        <div style={{
          padding: 12,
          marginBottom: 12,
          borderRadius: 8,
          border: '1px solid #dbeafe',
          background: '#eff6ff',
          color: '#1d4ed8',
          fontSize: 13,
        }}>
          Performance stream is disabled. Click <strong>Monitor performance</strong> to start live data.
        </div>
      )}

      {error && (
        <div style={{
          padding: 12,
          marginBottom: 12,
          borderRadius: 8,
          border: '1px solid #fecaca',
          background: '#fef2f2',
          color: '#b91c1c',
          fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 10,
        marginBottom: 14,
      }}>
        <StatCard
          title="Active logged-in users"
          value={formatNumber(stats?.users?.activeAuthenticated || 0)}
          subtitle={`Activity window: ${formatNumber(stats?.users?.activityWindowSec || 0)}s`}
        />
        <StatCard
          title="Requests / min"
          value={formatNumber(stats?.requests?.perMinute || 0)}
          subtitle={`Current traffic in last minute`}
        />
        <StatCard
          title="Total requests"
          subtitle={showRequestDetails ? 'Click to hide request details' : 'Click to show request details'}
          valueNode={(
            <button
              type="button"
              onClick={() => setShowRequestDetails((v) => !v)}
              style={{
                padding: 0,
                margin: 0,
                border: 'none',
                background: 'transparent',
                color: '#1d4ed8',
                textDecoration: 'underline',
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1.1,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {formatNumber(stats?.requests?.total || 0)}
            </button>
          )}
        />
        <StatCard
          title="HTTP 429 / min"
          value={formatNumber(stats?.requests?.rateLimitedPerMinute || 0)}
          subtitle={`Total 429: ${formatNumber(statusTotals['429'] || 0)}`}
        />
        <StatCard
          title="Errors 5xx / min"
          value={formatNumber(stats?.requests?.errors5xxPerMinute || 0)}
          subtitle={`Total 5xx: ${formatNumber(statusTotals['5xx'] || 0)}`}
        />
        <StatCard
          title="Response latency (avg 1m)"
          value={`${formatNumber(stats?.latency?.avgMs1m || 0, 1)} ms`}
          subtitle={`EWMA: ${formatNumber(stats?.latency?.ewmaMs || 0, 1)} ms`}
        />
        <StatCard
          title="In-flight requests"
          value={formatNumber(stats?.requests?.inFlight || 0)}
          subtitle={`Peak: ${formatNumber(stats?.requests?.peakInFlight || 0)}`}
        />
        <StatCard
          title="System memory used"
          valueNode={(
            <div style={{ fontSize: 22, lineHeight: 1.1, color: memColor, fontWeight: 700 }}>
              {formatNumber(memUsedPercent, 0)} %
            </div>
          )}
          subtitle={systemMem
            ? `${formatMb(systemMem.memAvailableMb)} available of ${formatMb(systemMem.memTotalMb)}`
            : 'Waiting for data'}
        />
        <StatCard
          title="Swap used"
          value={systemMem ? formatMb(systemMem.swapUsedMb) : '-'}
          subtitle={systemMem ? `of ${formatMb(systemMem.swapTotalMb)} swap` : 'Waiting for data'}
        />
        <StatCard
          title="Running workflow scripts"
          value={formatNumber(workflows.filter((w) => w.status === 'running').length)}
          subtitle={systemMem?.limits
            ? `Limit per script ${formatMb(systemMem.limits.maxMemoryMb)} (${systemMem.limits.cgroup ? 'hard cgroup' : systemMem.limits.cgroup === false ? 'soft watchdog' : 'probing'})`
            : 'Waiting for data'}
        />
      </div>

      <div style={{
        marginBottom: 14,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
      }}>
        <div style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e5e7eb',
          fontWeight: 600,
          color: '#111827',
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}>
          <span>Workflow runs (memory guard)</span>
          {systemMem?.limits && (
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400 }}>
              scripts start only with ≥ {formatMb(systemMem.limits.minAvailableMb)} available • per-script limit {formatMb(systemMem.limits.maxMemoryMb)}
              {systemMem.limits.cgroup === false && systemMem.limits.cgroupReason ? ` • cgroup unavailable: ${systemMem.limits.cgroupReason}` : ''}
            </span>
          )}
        </div>
        {workflows.length === 0 ? (
          <div style={{ padding: '12px', fontSize: 12, color: '#64748b' }}>
            No workflow is running right now.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc', color: '#334155' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Lab / result</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Run</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Current step</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Step status</th>
                <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>RSS now</th>
                <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Peak</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((w) => (
                <tr key={w.key}>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                    lab {w.labId} / #{w.resultId}
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap', color: WORKFLOW_STATUS_COLORS[w.status] || '#0f172a', fontWeight: 600 }}>
                    {w.debug ? '🛠 ' : '▶ '}{w.status} {w.currentStep}/{w.totalSteps}
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', wordBreak: 'break-all' }}>
                    {w.stepName || '-'}
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', color: WORKFLOW_STATUS_COLORS[w.stepStatus] || '#0f172a' }}>
                    {w.stepStatus || '-'}
                    {w.stepStatus === 'waiting' && w.waiting && (
                      <span style={{ color: '#b45309' }}>
                        {' '}({formatMb(w.waiting.availableMb)} free, needs {formatMb(w.waiting.requiredMb)})
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                    {w.rssMb != null ? formatMb(w.rssMb) : '-'}
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: '#64748b' }}>
                    {w.peakRssMb != null ? formatMb(w.peakRssMb) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{
        marginBottom: 14,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
      }}>
        <div style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e5e7eb',
          fontWeight: 600,
          color: '#111827',
          fontSize: 13,
        }}>
          Request limits
        </div>
        <div style={{
          padding: '10px 12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 8,
          fontSize: 12,
          color: '#374151',
        }}>
          <div>JSON body limit: <strong>{requestLimits.jsonBodyLimit}</strong></div>
          <div>Auth limit: <strong>{formatNumber((requestLimits.auth?.windowMs || 0) / 1000, 0)} s / {formatNumber(requestLimits.auth?.maxPerIp || 0)} req/IP</strong></div>
          <div>API limit: <strong>{formatNumber((requestLimits.api?.windowMs || 0) / 1000, 0)} s / {formatNumber(requestLimits.api?.maxPerKey || 0)} req/key</strong></div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
        gap: 10,
      }}>
        <SparkChart
          title="Request throughput"
          value={`${formatNumber(stats?.requests?.perMinute || 0)} req/min`}
          data={history.requestsPerMinute}
          color="#22c55e"
        />
        <SparkChart
          title="Rate limited requests"
          value={`${formatNumber(stats?.requests?.rateLimitedPerMinute || 0)} / min`}
          data={history.rateLimitedPerMinute}
          color="#f59e0b"
        />
        <SparkChart
          title="Active users"
          value={`${formatNumber(stats?.users?.activeAuthenticated || 0)} users`}
          data={history.activeUsers}
          color="#38bdf8"
        />
        <SparkChart
          title="Average latency"
          value={`${formatNumber(stats?.latency?.avgMs1m || 0, 1)} ms`}
          data={history.avgLatencyMs1m}
          color="#a3e635"
        />
        <SparkChart
          title="Process CPU"
          value={`${formatNumber(stats?.runtime?.cpuPercent || 0, 1)} %`}
          data={history.cpuPercent}
          color="#f97316"
        />
        <SparkChart
          title="RSS memory"
          value={`${formatNumber(stats?.runtime?.rssMb || 0, 1)} MB`}
          data={history.rssMb}
          color="#60a5fa"
        />
        <PercentUsageChart
          title="System memory used"
          subtitle={systemMem
            ? `${formatMb(systemMem.memUsedMb)} used • ${formatMb(systemMem.memAvailableMb)} available • swap ${formatMb(systemMem.swapUsedMb)}`
            : 'Whole machine (MemAvailable from /proc/meminfo)'}
          value={`${formatNumber(memUsedPercent, 1)} %`}
          data={history.systemMemPercent}
          color={memColor}
        />
      </div>

      <div style={{
        marginTop: 14,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
      }}>
        <div style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e5e7eb',
          fontWeight: 600,
          color: '#111827',
          fontSize: 13,
        }}>
          Request Usage
        </div>

        {apiKeyUsageItems.length === 0 ? (
          <div style={{ padding: '12px', fontSize: 12, color: '#64748b' }}>
            No active user keys in the current rate-limit window.
          </div>
        ) : (
          <div style={{
            padding: 10,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 10,
          }}>
            {apiKeyUsageItems.map((item) => {
              const key = String(item?.key || '');
              const percent = clamp(Number(item?.usagePercent || 0), 0, 100);
              const color = percent >= 90 ? '#ef4444' : percent >= 70 ? '#f59e0b' : '#22c55e';
              const userName = item?.userName || `User #${item?.userId || '?'}`;
              const historyData = usageHistoryByKey[key] || [percent];
              return (
                <div key={key} style={{ width: '100%', maxWidth: 560, justifySelf: 'center' }}>
                  <PercentUsageChart
                    title={`${userName}`}
                    subtitle={`${key} • ${formatNumber(item?.used || 0)} / ${formatNumber(item?.max || 0)} req`}
                    value={`${formatNumber(percent, 1)} %`}
                    data={historyData}
                    color={color}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showRequestDetails && (
        <div style={{
          marginTop: 14,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#fff',
        }}>
          <div style={{
            padding: '10px 12px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ fontWeight: 600, color: '#111827', fontSize: 13 }}>
              Request details (newest first)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                Observed: {formatNumber(requestDetailsMeta.totalObserved)} • Buffered: {formatNumber(requestDetailsMeta.buffered)}
              </span>
              <button
                type="button"
                onClick={() => loadRequestDetails.current()}
                style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  background: '#fff',
                  fontSize: 11,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  color: '#0f172a',
                }}
              >
                Refresh
              </button>
            </div>
          </div>

          {requestDetailsError && (
            <div style={{ padding: '8px 12px', color: '#b91c1c', fontSize: 12, borderBottom: '1px solid #fee2e2', background: '#fef2f2' }}>
              {requestDetailsError}
            </div>
          )}

          <div style={{ maxHeight: 290, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr style={{ background: '#f8fafc', color: '#334155' }}>
                  <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Time</th>
                  <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Method</th>
                  <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Endpoint</th>
                  <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Latency (ms)</th>
                  <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>User</th>
                </tr>
              </thead>
              <tbody>
                {requestDetails.map((r, idx) => {
                  const statusColor = r.statusCode >= 500
                    ? '#dc2626'
                    : r.statusCode >= 400
                      ? '#d97706'
                      : '#0f172a';
                  return (
                    <tr key={`${r.timestamp}-${idx}`} style={{ background: idx % 2 ? '#fcfcfd' : '#fff' }}>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap', color: '#475569' }}>
                        {new Date(r.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{r.method}</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                        {r.endpoint}{r.query ? `?${r.query}` : ''}
                      </td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: statusColor, fontWeight: 700 }}>
                        {r.statusCode}
                      </td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>
                        {formatNumber(Number(r.latencyMs || 0), 2)}
                      </td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: '#64748b' }}>
                        {r.userId || '-'}
                      </td>
                    </tr>
                  );
                })}
                {requestDetails.length === 0 && !requestDetailsLoading && (
                  <tr>
                    <td colSpan={6} style={{ padding: '12px', color: '#64748b', textAlign: 'center' }}>
                      No request details buffered yet.
                    </td>
                  </tr>
                )}
                {requestDetailsLoading && (
                  <tr>
                    <td colSpan={6} style={{ padding: '12px', color: '#64748b', textAlign: 'center' }}>
                      Loading request details...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{
        marginTop: 14,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
      }}>
        <div style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ fontWeight: 600, color: '#111827', fontSize: 13 }}>
            Page loads of this browser tab (newest first)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>
              Explains unexpected "refreshes": a reload while the tab was hidden means the browser unloaded it to save memory.
            </span>
            <button
              type="button"
              onClick={() => { clearPageLoads(); setPageLoads([]); }}
              style={{ border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', fontSize: 11, padding: '4px 8px', cursor: 'pointer', color: '#0f172a' }}
            >
              Clear
            </button>
          </div>
        </div>
        <div style={{ maxHeight: 220, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0 }}>
              <tr style={{ background: '#f8fafc', color: '#334155' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Loaded at</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Discarded</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Previous page went away</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Interpretation</th>
              </tr>
            </thead>
            <tbody>
              {[...pageLoads].reverse().map((p, idx) => (
                <tr key={`${p.at}-${idx}`} style={{ background: idx % 2 ? '#fcfcfd' : '#fff' }}>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap', color: '#475569' }}>{new Date(p.at).toLocaleString()}</td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontWeight: 600, color: p.type === 'reload' ? '#b45309' : '#0f172a' }}>{p.type}</td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', color: p.wasDiscarded ? '#dc2626' : '#64748b' }}>{p.wasDiscarded ? 'yes' : 'no'}</td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', color: '#475569', whiteSpace: 'nowrap' }}>
                    {p.lastHide ? `${new Date(p.lastHide.at).toLocaleString()} (${p.lastHide.event})` : '-'}
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', color: '#374151' }}>{explainPageLoad(p)}</td>
                </tr>
              ))}
              {pageLoads.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 12, color: '#64748b', textAlign: 'center' }}>No page loads recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{
        marginTop: 14,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
      }}>
        <div style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e5e7eb',
          fontWeight: 600,
          color: '#111827',
          fontSize: 13,
        }}>
          Runtime details
        </div>
        <div style={{
          padding: '10px 12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 8,
          fontSize: 12,
          color: '#374151',
        }}>
          <div>Chat-connected users: <strong>{formatNumber(stats?.users?.activeInChat || 0)}</strong></div>
          <div>Event loop lag: <strong>{formatNumber(stats?.runtime?.eventLoopLagMs || 0, 2)} ms</strong></div>
          <div>Heap used: <strong>{formatNumber(stats?.runtime?.heapUsedMb || 0, 1)} MB</strong></div>
          <div>Heap total: <strong>{formatNumber(stats?.runtime?.heapTotalMb || 0, 1)} MB</strong></div>
          <div>External memory: <strong>{formatNumber(stats?.runtime?.externalMb || 0, 1)} MB</strong></div>
          <div>Load avg (1m): <strong>{formatNumber(stats?.runtime?.loadAvg1m || 0, 2)}</strong></div>
          <div>CPU cores: <strong>{formatNumber(systemMem?.cpuCount || 0)}</strong></div>
          <div>System RAM: <strong>{systemMem ? formatMb(systemMem.memTotalMb) : '-'}</strong></div>
          <div>Active performance streams: <strong>{formatNumber(stats?.runtime?.activePerformanceStreams || 0)}</strong></div>
          <div>HTTP 2xx: <strong>{formatNumber(statusTotals['2xx'] || 0)}</strong></div>
          <div>HTTP 3xx: <strong>{formatNumber(statusTotals['3xx'] || 0)}</strong></div>
          <div>HTTP 4xx: <strong>{formatNumber(statusTotals['4xx'] || 0)}</strong></div>
          <div>HTTP 5xx: <strong>{formatNumber(statusTotals['5xx'] || 0)}</strong></div>
          <div>Uptime: <strong>{formatNumber(stats?.uptimeSec || 0)} s</strong></div>
        </div>
      </div>
    </div>
  );
}