import { useState, useEffect, useCallback, useRef } from 'react'
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

function getFaviconUrl(jobUrl) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(jobUrl).hostname}&sz=32` }
  catch { return null }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard({ stats, onStatsChange, isAdmin }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [newFilter, setNewFilter]     = useState('all')    // all | new
  const [roleTab, setRoleTab]         = useState('all')    // all | intern | apm
  const [locationFilter, setLocation] = useState('us_only') // all | us_only | remote | remote_us
  const [alert, setAlert] = useState(null)
  const [hasResume, setHasResume] = useState(false)
  const [atsScores, setAtsScores] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ats_scores') || '{}') } catch { return {} }
  })
  const [atsModal, setAtsModal] = useState(null)  // null | { job, score, matched, missing, tailoredScore }
  const tailoredInputRef = useRef(null)

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

  useEffect(() => {
    api.getResume().then(r => setHasResume(r.exists)).catch(() => {})
  }, [])

  useEffect(() => {
    const toSave = Object.fromEntries(
      Object.entries(atsScores).filter(([, v]) => v && v !== 'loading')
    )
    localStorage.setItem('ats_scores', JSON.stringify(toSave))
  }, [atsScores])

  function clearAtsCache() {
    localStorage.removeItem('ats_scores')
    setAtsScores({})
  }

  async function handleATSClick(e, job) {
    e.stopPropagation()
    const cached = atsScores[job.id]
    if (cached && cached !== 'loading') {
      setAtsModal({ job, ...cached, tailoredScore: null })
      return
    }
    setAtsScores(prev => ({ ...prev, [job.id]: 'loading' }))
    try {
      const result = await api.atsScore(job.id)
      setAtsScores(prev => ({ ...prev, [job.id]: result }))
      setAtsModal({ job, ...result, tailoredScore: null })
    } catch {
      setAtsScores(prev => ({ ...prev, [job.id]: undefined }))
    }
  }

  async function handleTailoredUpload(file) {
    if (!file || !atsModal) return
    const jobId = atsModal.job.id
    setAtsModal(prev => ({ ...prev, tailoredScore: 'loading' }))
    try {
      const result = await api.atsTempScore(jobId, file)
      setAtsModal(prev => ({ ...prev, tailoredScore: result }))
    } catch {
      setAtsModal(prev => ({ ...prev, tailoredScore: null }))
    }
  }

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
      {/* ATS Modal */}
      {atsModal && (() => {
        const tailored = atsModal.tailoredScore
        const activeKw = (tailored && tailored !== 'loading') ? tailored : atsModal
        return (
          <div
            onClick={() => setAtsModal(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1000, padding: 16,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: '#fff', borderRadius: 14, padding: 28,
                width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
                maxHeight: '85vh', overflowY: 'auto',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 2 }}>ATS Score</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{atsModal.job.title}</div>
                  {atsModal.job.company && <div style={{ fontSize: 12, color: '#94a3b8' }}>{atsModal.job.company}</div>}
                </div>
                <button onClick={() => setAtsModal(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>

              {/* Score(s) */}
              {(tailored && tailored !== 'loading') ? (
                <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 24 }}>
                  {[{ label: 'Base resume', s: atsModal.score }, { label: 'Tailored', s: tailored.score }].map(({ label, s }) => (
                    <div key={label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1, color: s >= 70 ? '#16a34a' : s >= 40 ? '#d97706' : '#dc2626' }}>{s}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>/ 100</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1, color: atsModal.score >= 70 ? '#16a34a' : atsModal.score >= 40 ? '#d97706' : '#dc2626' }}>
                    {atsModal.score}
                  </div>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>out of 100</div>
                </div>
              )}

              {/* Keywords (show tailored if available) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Matched ({activeKw.matched.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {activeKw.matched.map(kw => (
                      <span key={kw} style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', fontSize: 12, padding: '2px 8px', borderRadius: 10 }}>{kw}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Missing ({activeKw.missing.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {activeKw.missing.map(kw => (
                      <span key={kw} style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: 12, padding: '2px 8px', borderRadius: 10 }}>{kw}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tailored resume upload */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                {tailored === 'loading' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#64748b' }}>
                    <span className="spinner" style={{ borderTopColor: '#475569', borderColor: 'rgba(0,0,0,0.1)' }} />
                    Scoring tailored resume…
                  </div>
                ) : !tailored ? (
                  <label style={{ cursor: 'pointer' }}>
                    <input
                      ref={tailoredInputRef}
                      type="file"
                      accept=".pdf"
                      style={{ display: 'none' }}
                      onChange={e => { if (e.target.files[0]) handleTailoredUpload(e.target.files[0]) }}
                    />
                    <span className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', gap: 6, cursor: 'pointer' }}>
                      📄 Score with tailored resume
                    </span>
                  </label>
                ) : (
                  <label style={{ cursor: 'pointer' }}>
                    <input
                      ref={tailoredInputRef}
                      type="file"
                      accept=".pdf"
                      style={{ display: 'none' }}
                      onChange={e => { if (e.target.files[0]) handleTailoredUpload(e.target.files[0]) }}
                    />
                    <span className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', gap: 6, cursor: 'pointer' }}>
                      📄 Re-score with different resume
                    </span>
                  </label>
                )}
              </div>
            </div>
          </div>
        )
      })()}

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
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            {newCount > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={handleMarkAllSeen}>Mark all seen</button>
            )}
            <button className="btn btn-primary btn-sm" onClick={handleCheckNow} disabled={checking}>
              {checking ? <><span className="spinner" /> Checking…</> : '⟳ Check now'}
            </button>
          </div>
        )}
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
              <div
                key={job.id}
                className={`job-card ${job.is_new ? 'is-new' : ''}`}
                onClick={() => window.open(job.url, '_blank', 'noopener,noreferrer')}
              >
                <div className="job-info">
                  <a className="job-title" href={job.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                    {job.title}
                  </a>
                  <div className="job-meta">
                    {job.company && (
                      <span className="job-meta-item">
                        <img
                          src={getFaviconUrl(job.url)}
                          width={16} height={16}
                          style={{ borderRadius: 3, flexShrink: 0 }}
                          onError={e => { e.target.style.display = 'none' }}
                          alt=""
                        />
                        {job.company}
                      </span>
                    )}
                    {job.location    && <span className="job-meta-item">📍 {job.location}</span>}
                    {job.website_name && <span className="job-meta-item">🔗 {job.website_name}</span>}
                    <span className="job-meta-item">
                      🕐 {formatPostedDate(job.posted_at, job.first_seen)}
                      {job.posted_at && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>(posted)</span>}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {hasResume && <ATSBadge score={atsScores[job.id]} onClick={e => handleATSClick(e, job)} />}
                  {isIntern && <RolePill color="violet">INTERN</RolePill>}
                  {isApm    && <RolePill color="green">APM</RolePill>}
                  {job.is_new && <span className="new-pill">NEW</span>}
                  {job.is_new && isAdmin && (
                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); handleMarkSeen(job.id) }} title="Mark as seen">✓</button>
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

function ATSBadge({ score, onClick }) {
  let bg = '#f1f5f9', color = '#64748b', label = 'ATS'
  if (score === 'loading') {
    label = '…'
  } else if (score) {
    label = `${score.score}%`
    if (score.score >= 70)      { bg = '#f0fdf4'; color = '#16a34a' }
    else if (score.score >= 40) { bg = '#fffbeb'; color = '#d97706' }
    else                        { bg = '#fef2f2'; color = '#dc2626' }
  }
  return (
    <span
      onClick={onClick}
      title="ATS keyword score"
      style={{
        background: bg, color, border: `1px solid ${color}22`,
        fontSize: 11, fontWeight: 700,
        padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {label}
    </span>
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
