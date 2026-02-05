/**
 * Centralized API Communication Utility
 * 
 * Wrapper around fetch() that provides:
 * - Automatic JWT token injection from localStorage
 * - JSON response parsing
 * - Consistent error handling with detailed messages
 * - Support for 204 No Content responses
 * 
 * @param {string} url - API endpoint URL
 * @param {object} opts - Fetch options (method, headers, body, etc.)
 * @returns {Promise<object|null>} - Parsed JSON response or null for 204
 * @throws {Error} - Enhanced error with status, url, and body info
 */
export async function fetchJSON(url, opts = {}) {
  try {
    // Automatically add Authorization header if token exists
    const token = localStorage.getItem('authToken');
    if (token) {
      opts = {
        ...opts,
        headers: {
          ...opts.headers,
          'Authorization': `Bearer ${token}`
        }
      };
    }
      
    const res = await fetch(url, opts);
    
    // Handle 204 No Content response
    if (res.status === 204) return null;
    
    if (!res.ok) {
      // Try to read response body for diagnostics
      let body = '';
      try { body = await res.text(); } catch { /* ignore */ }
      const err = new Error(`HTTP ${res.status} ${res.statusText} @ ${url}${body ? ` — ${body}` : ''}`);
      err.status = res.status;
      err.url = url;
      err.body = body;
      throw err;
    }
    
    return await res.json();
  } catch (e) {
    console.error('fetchJSON error:', e?.message || e, 'URL:', url, 'opts:', opts);
    throw e;
  }
}