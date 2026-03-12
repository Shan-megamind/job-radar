import { useState, useEffect, useCallback } from 'react'
import Dashboard from './components/Dashboard'
import WebsiteManager from './components/WebsiteManager'
import Settings from './components/Settings'
import { api } from './api'

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const isAdmin = new URLSearchParams(window.location.search).get('admin') === 'jobradar2026'

  const loadStats = useCallback(async () => {
    try {
      const s = await api.getStats()
      setStats(s)
    } catch { /* silently fail */ }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  return (
    <div className="app">
      <nav className="navbar">
        <div className="navbar-brand">
          <span>📡</span> Job Radar
        </div>
        <div className="nav-tabs">
          <button className={`nav-tab ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
            Dashboard
            {stats?.new_jobs > 0 && <span className="badge">{stats.new_jobs}</span>}
          </button>
          <button className={`nav-tab ${tab === 'websites' ? 'active' : ''}`} onClick={() => setTab('websites')}>
            Websites
            {stats?.total_sites > 0 && <span style={{ fontSize: 12, color: '#64748b', marginLeft: 4 }}>{stats.total_sites}</span>}
          </button>
          <button className={`nav-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
            Settings
          </button>
        </div>
      </nav>

      <main className="main">
        {tab === 'dashboard' && <Dashboard stats={stats} onStatsChange={loadStats} isAdmin={isAdmin} />}
        {tab === 'websites' && <WebsiteManager onStatsChange={loadStats} isAdmin={isAdmin} />}
        {tab === 'settings' && <Settings isAdmin={isAdmin} />}
      </main>

      <footer className="footer">YOU'RE HIRED! Haha made you look</footer>
    </div>
  )
}
