import { useState, useEffect } from 'react'
import { api } from '../api'

function formatDate(dateStr) {
  if (!dateStr) return 'Never'
  const d = new Date(dateStr + 'Z')
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function WebsiteManager({ onStatsChange, isAdmin }) {
  const [websites, setWebsites] = useState([])
  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState(null)

  // Form state
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [jobSelector, setJobSelector] = useState('')
  const [titleSelector, setTitleSelector] = useState('')
  const [linkSelector, setLinkSelector] = useState('')
  const [keywords, setKeywords] = useState('')
  const [adding, setAdding] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all') // all | error
  const [removingErroring, setRemovingErroring] = useState(false)

  async function loadWebsites() {
    try {
      const data = await api.getWebsites()
      setWebsites(data)
    } catch (e) {
      setAlert({ type: 'error', msg: e.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadWebsites() }, [])

  async function handleAdd(e) {
    e.preventDefault()
    if (!url.trim()) return
    setAdding(true)
    setAlert(null)
    try {
      const payload = { url: url.trim(), name: name.trim() || undefined }
      if (showAdvanced) {
        if (jobSelector.trim()) payload.job_selector = jobSelector.trim()
        if (titleSelector.trim()) payload.title_selector = titleSelector.trim()
        if (linkSelector.trim()) payload.link_selector = linkSelector.trim()
        if (keywords.trim()) payload.keywords = keywords.split(',').map(k => k.trim()).filter(Boolean)
      }
      await api.addWebsite(payload)
      setUrl(''); setName(''); setJobSelector(''); setTitleSelector(''); setLinkSelector(''); setKeywords('')
      await loadWebsites()
      onStatsChange?.()
      setAlert({ type: 'success', msg: 'Website added successfully.' })
    } catch (e) {
      setAlert({ type: 'error', msg: e.message })
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(id, name) {
    if (!confirm(`Remove "${name}"? All associated jobs will be deleted.`)) return
    try {
      await api.removeWebsite(id)
      await loadWebsites()
      onStatsChange?.()
    } catch (e) {
      setAlert({ type: 'error', msg: e.message })
    }
  }

  async function handleRemoveErroring() {
    const errorCount = websites.filter(s => s.last_status === 'error').length
    if (!confirm(`Remove all ${errorCount} erroring site${errorCount !== 1 ? 's' : ''}? This will also delete their associated jobs.`)) return
    setRemovingErroring(true)
    setAlert(null)
    try {
      const result = await api.removeErroringWebsites()
      setAlert({ type: 'success', msg: `Removed ${result.removed} erroring site${result.removed !== 1 ? 's' : ''}.` })
      setStatusFilter('all')
      await loadWebsites()
      onStatsChange?.()
    } catch (e) {
      setAlert({ type: 'error', msg: e.message })
    } finally {
      setRemovingErroring(false)
    }
  }

  const errorCount = websites.filter(s => s.last_status === 'error').length
  const visibleWebsites = statusFilter === 'error'
    ? websites.filter(s => s.last_status === 'error')
    : websites

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Monitored Websites</h2>

      {alert && (
        <div className={`alert alert-${alert.type}`} style={{ marginBottom: 16 }}>{alert.msg}</div>
      )}

      {/* Add form */}
      {isAdmin && <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">Add Website</span>
        </div>
        <form onSubmit={handleAdd}>
          <div className="form-row">
            <div className="form-group">
              <label>URL *</label>
              <input
                className="input-url"
                type="url"
                placeholder="https://company.com/careers"
                value={url}
                onChange={e => setUrl(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Display name</label>
              <input
                className="input-name"
                type="text"
                placeholder="Acme Corp"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-primary" disabled={adding}>
                {adding ? <><span className="spinner" /> Adding…</> : '+ Add'}
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowAdvanced(v => !v)}
            style={{ marginBottom: showAdvanced ? 12 : 0 }}
          >
            {showAdvanced ? '▲ Hide advanced' : '▼ Advanced (custom selectors)'}
          </button>

          {showAdvanced && (
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              <div className="form-group">
                <label>Job container selector</label>
                <input type="text" placeholder=".job-listing" value={jobSelector} onChange={e => setJobSelector(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Title selector</label>
                <input type="text" placeholder="h3.title" value={titleSelector} onChange={e => setTitleSelector(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Link selector</label>
                <input type="text" placeholder="a.apply" value={linkSelector} onChange={e => setLinkSelector(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Keywords (comma-separated)</label>
                <input type="text" placeholder="product manager, PM, program manager" value={keywords} onChange={e => setKeywords(e.target.value)} />
              </div>
            </div>
          )}
        </form>
      </div>}

      {/* Filter row */}
      {!loading && websites.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="filter-label">Filter:</span>
            <button
              className={`btn btn-sm ${statusFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStatusFilter('all')}
            >
              All ({websites.length})
            </button>
            <button
              className={`btn btn-sm ${statusFilter === 'error' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStatusFilter('error')}
              style={errorCount > 0 && statusFilter !== 'error' ? { color: '#ef4444', borderColor: '#fecaca' } : {}}
            >
              Errors {errorCount > 0 && `(${errorCount})`}
            </button>
          </div>

          {statusFilter === 'error' && errorCount > 0 && isAdmin && (
            <button
              className="btn btn-danger btn-sm"
              onClick={handleRemoveErroring}
              disabled={removingErroring}
            >
              {removingErroring
                ? <><span className="spinner" style={{ borderTopColor: '#ef4444', borderColor: '#fecaca' }} /> Removing…</>
                : `Remove all ${errorCount} erroring site${errorCount !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}

      {/* Website list */}
      {loading ? (
        <div className="empty"><p>Loading…</p></div>
      ) : visibleWebsites.length === 0 ? (
        <div className="empty">
          <h3>{statusFilter === 'error' ? 'No erroring sites' : 'No websites yet'}</h3>
          <p>{statusFilter === 'error' ? 'All sites are healthy.' : 'Add a career page URL above to start monitoring.'}</p>
        </div>
      ) : (
        <div className="website-list">
          {visibleWebsites.map(site => (
            <div key={site.id} className="website-row">
              <div className="website-info">
                <div className="website-name">{site.name || site.url}</div>
                <div className="website-url">{site.url}</div>
              </div>
              <div className="website-status" title={site.last_error || undefined}>
                <span className={`status-dot ${site.last_status}`} />
                <span>{site.last_status}</span>
                {site.last_error && (
                  <span style={{ fontSize: 12, color: '#ef4444', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    — {site.last_error}
                  </span>
                )}
              </div>
              <div className="website-jobs">
                {site.job_count} role{site.job_count !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>
                {site.last_checked ? `Checked ${formatDate(site.last_checked)}` : 'Not checked yet'}
              </div>
              {isAdmin && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleRemove(site.id, site.name || site.url)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
