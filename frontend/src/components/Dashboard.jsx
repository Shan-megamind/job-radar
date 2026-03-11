import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

// ── Constants ─────────────────────────────────────────────────────────────────

// Keep in sync with scraper.py INTERN_KEYWORDS
const INTERN_KW = ['intern', 'internship']

const APM_KW = [
  'associate product manager',
  'apm intern', 'apm program', 'apm',
  'rotational product manager',
  'rpm program', 'rpm intern', 'rpm',
]

function kwRegex(kw) {
  return new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
}

// Countries/cities that indicate non-US location
const NON_US = [
  'united kingdom', 'uk', ' uk,', 'canada', 'toronto', 'vancouver',
  'germany', 'berlin', 'munich', 'france', 'paris', 'amsterdam',
  'netherlands', 'ireland', 'dublin', 'spain', 'madrid', 'barcelona',
  'australia', 'sydney', 'melbourne', 'india', 'bangalore', 'mumbai',
  'singapore', 'brazil', 'mexico', 'japan', 'tokyo', 'china', 'beijing',
  'shanghai', 'poland', 'warsaw', 'sweden', 'stockholm',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesRole(title, tab) {
  if (tab === 'all') return true
  if (tab === 'intern') return INTERN_KW.some(kw => kwRegex(kw).test(title))
  if (tab === 'apm')    return APM_KW.some(kw => kwRegex(kw).test(title))
  return true
}

function matchesLocation(job, filter) {
  if (filter === 'all') return true
  const loc = (' ' + (job.location || '')).toLowerCase()
  const isRemote = loc.includes('remote')
  const isNonUS  = NON_US.some(c => loc.includes(c))
  if (filter === 'remote')    return isRemote
  if (filter === 'remote_us') return isRemote && !isNonUS
  if (filter === 'us_only')   return !isNonUS
  return true
}

function formatPostedDate(postedAt, firstSeen) {
  // postedAt comes from the API; firstSeen is our scrape time
  const src = postedAt || firstSeen
  if (!src) return 'Recently posted'
  const d = new Date(src + (src.endsWith('Z') ? '' : 'Z'))
  if (isNaN(d.getTime())) return 'Recently posted'
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60)    return 'Just posted'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard({ stats, onStatsChange }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [newFilter, setNewFilter]     = useState('all')    // all | new
  const [roleTab, setRoleTab]         = useState('all')    // all | intern | apm
  const [locationFilter, setLocation] = useState('us_only') // all | us_only | remote | remote_us
  const [alert, setAlert] = useState(null)

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const params = newFilter === 'new' ? { is_new: true } : {}
      setJobs(await api.getJobs(params))
    } catch (e) {
      setAlert({ type: 'error', msg: e.message })
    } finally {
      setLoading(false)
    }
  }, [newFilter])

  useEffect(() => { loadJobs() }, [loadJobs])

  async function handleCheckNow() {
    setChecking(true)
    setAlert(null)
    try {
      const result = await api.checkNow()
      setAlert({ type: 'success', msg: `Check complete — ${result.new_jobs} new job${result.new_jobs !== 1 ? 's' : ''} found across ${result.checked} sites.` })
      await loadJobs()
      onStatsChange?.()
    } catch (e) {
      setAlert({ type: 'error', msg: e.message })
    } finally {
      setChecking(false)
    }
  }

  async function handleMarkAllSeen() {
    await api.markAllSeen()
    await loadJobs()
    onStatsChange?.()
  }

  async function handleMarkSeen(jobId) {
    await api.markJobSeen(jobId)
    setJobs(jobs.map(j => j.id === jobId ? { ...j, is_new: false } : j))
    onStatsChange?.()
  }

  // Counts for tab badges (before location filter so they reflect total role counts)
  const internCount = jobs.filter(j => matchesRole(j.title, 'intern')).length
  const apmCount    = jobs.filter(j => matchesRole(j.title, 'apm')).length
  const newCount    = jobs.filter(j => j.is_new).length

  const visibleJobs = jobs
    .filter(j => matchesRole(j.title, roleTab))
    .filter(j => matchesLocation(j, locationFilter))

  return (
    <div>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{stats?.total_jobs ?? '—'}</div>
          <div className="stat-label">Total roles found</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: stats?.new_jobs > 0 ? '#2563eb' : undefined }}>
            {stats?.new_jobs ?? '—'}
          </div>
          <div className="stat-label">New (unseen)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats?.total_sites ?? '—'}</div>
          <div className="stat-label">Sites monitored</div>
        </div>
      </div>

      {/* Header */}
      <div className="card-header" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Job Openings</h2>
          {newCount > 0 && <span className="badge">{newCount} new</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {newCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={handleMarkAllSeen}>Mark all seen</button>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleCheckNow} disabled={checking}>
            {checking ? <><span className="spinner" /> Checking…</> : '⟳ Check now'}
          </button>
        </div>
      </div>

      {alert && <div className={`alert alert-${alert.type}`}>{alert.msg}</div>}

      {/* Role tabs + filters row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>

        {/* Role tabs */}
        <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 4, borderRadius: 8 }}>
          {[
            { key: 'all',    label: 'All Roles' },
            { key: 'intern', label: 'Intern', count: internCount },
            { key: 'apm',    label: 'APM',    count: apmCount },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setRoleTab(key)}
              style={{
                border: 'none', borderRadius: 6, padding: '6px 14px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: roleTab === key ? '#fff' : 'transparent',
                color: roleTab === key ? '#0f172a' : '#64748b',
                boxShadow: roleTab === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.15s',
              }}
            >
              {label}
              {count > 0 && (
                <span style={{
                  background: roleTab === key ? '#2563eb' : '#e2e8f0',
                  color: roleTab === key ? '#fff' : '#475569',
                  fontSize: 11, fontWeight: 700,
                  padding: '1px 6px', borderRadius: 10,
                }}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Right-side filters */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Location filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="filter-label">📍</span>
            <select
              value={locationFilter}
              onChange={e => setLocation(e.target.value)}
              style={{ fontSize: 13, padding: '5px 10px', borderRadius: 7 }}
            >
              <option value="all">All Locations</option>
              <option value="us_only">US Only</option>
              <option value="remote">Remote</option>
              <option value="remote_us">Remote US</option>
            </select>
          </div>

          {/* New filter */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`btn btn-sm ${newFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setNewFilter('all')}
            >
              All
            </button>
            <button
              className={`btn btn-sm ${newFilter === 'new' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setNewFilter('new')}
            >
              New only
            </button>
          </div>
        </div>
      </div>

      {/* Job list */}
      {loading ? (
        <div className="empty"><p>Loading…</p></div>
      ) : visibleJobs.length === 0 ? (
        <div className="empty">
          <h3>No jobs found</h3>
          <p>
            {roleTab === 'intern' ? 'No intern roles match the current filters.' :
             roleTab === 'apm'    ? 'No APM roles match the current filters.' :
             newFilter === 'new'  ? 'No new roles. Click "Check now" to scrape sites.' :
             'Add sites to monitor and click "Check now".'}
          </p>
        </div>
      ) : (
        <div className="jobs-grid">
          {visibleJobs.map(job => {
            const isIntern = matchesRole(job.title, 'intern')
            const isApm    = matchesRole(job.title, 'apm')
            return (
              <div key={job.id} className={`job-card ${job.is_new ? 'is-new' : ''}`}>
                <div className="job-info">
                  <a className="job-title" href={job.url} target="_blank" rel="noopener noreferrer">
                    {job.title}
                  </a>
                  <div className="job-meta">
                    {job.company     && <span className="job-meta-item">🏢 {job.company}</span>}
                    {job.location    && <span className="job-meta-item">📍 {job.location}</span>}
                    {job.website_name && <span className="job-meta-item">🔗 {job.website_name}</span>}
                    <span className="job-meta-item">
                      🕐 {formatPostedDate(job.posted_at, job.first_seen)}
                      {job.posted_at && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>(posted)</span>}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {isIntern && <RolePill color="violet">INTERN</RolePill>}
                  {isApm    && <RolePill color="green">APM</RolePill>}
                  {job.is_new && <span className="new-pill">NEW</span>}
                  {job.is_new && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handleMarkSeen(job.id)} title="Mark as seen">✓</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RolePill({ color, children }) {
  const styles = {
    violet: { background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe' },
    green:  { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
  }
  return (
    <span style={{
      ...styles[color],
      fontSize: 11, fontWeight: 700,
      padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}
