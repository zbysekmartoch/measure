import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

export default function WhatsNewPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/whatsnew')
      .then(r => r.json())
      .then(data => { setEntries(data); setLoading(false); })
      .catch(() => { setError('Nepodařilo se načíst novinky.'); setLoading(false); });
  }, []);

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.headerInner}>
            <div style={styles.logoRow}>
              <span style={styles.logo}>🔬</span>
              <h1 style={styles.title}>Measure — Novinky</h1>
            </div>
            <a href="/" style={styles.backLink}>← Zpět do aplikace</a>
          </div>
        </header>

        <main style={styles.main}>
          {loading && <p style={styles.loadingText}>Načítání…</p>}
          {error && <p style={styles.errorText}>{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p style={styles.emptyText}>Zatím žádné novinky.</p>
          )}
          {entries.map((entry, i) => (
            <article key={entry.version} style={{ ...styles.card, ...(i === 0 ? styles.cardLatest : {}) }}>
              {i === 0 && <span style={styles.latestBadge}>Nejnovější</span>}
              <div style={styles.cardContent}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {entry.content}
                </ReactMarkdown>
              </div>
            </article>
          ))}
        </main>

        <footer style={styles.footer}>
          <span>Measure © {new Date().getFullYear()}</span>
        </footer>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 50%, #f5f0ff 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  container: {
    maxWidth: 760,
    margin: '0 auto',
    padding: '0 24px',
  },
  header: {
    padding: '32px 0 16px',
    borderBottom: '1px solid rgba(0,0,0,0.08)',
    marginBottom: 32,
  },
  headerInner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    fontSize: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#1a1a2e',
    margin: 0,
  },
  backLink: {
    color: '#4f46e5',
    textDecoration: 'none',
    fontWeight: 500,
    fontSize: 14,
  },
  main: {
    paddingBottom: 48,
  },
  loadingText: {
    textAlign: 'center',
    color: '#6b7280',
    fontSize: 16,
    padding: 40,
  },
  errorText: {
    textAlign: 'center',
    color: '#dc2626',
    fontSize: 16,
    padding: 40,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 16,
    padding: 40,
  },
  card: {
    position: 'relative',
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
    marginBottom: 24,
    overflow: 'hidden',
    transition: 'box-shadow 0.2s ease',
  },
  cardLatest: {
    border: '2px solid #4f46e5',
    boxShadow: '0 4px 12px rgba(79,70,229,0.15), 0 1px 3px rgba(0,0,0,0.08)',
  },
  latestBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: 20,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardContent: {
    padding: '28px 32px',
    lineHeight: 1.7,
    color: '#374151',
    fontSize: 15,
  },
  footer: {
    textAlign: 'center',
    padding: '24px 0',
    borderTop: '1px solid rgba(0,0,0,0.06)',
    color: '#9ca3af',
    fontSize: 13,
  },
};
