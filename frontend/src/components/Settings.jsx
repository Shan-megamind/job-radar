import { useState, useEffect } from 'react'
import { api } from '../api'

export default function Settings({ isAdmin }) {
  const [settings, setSettings] = useState(null)
  const [interval, setInterval] = useState('6')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [alert, setAlert] = useState(null)

  useEffect(() => {
    api.getSettings().then(s => {
      setSettings(s)
      setInterval(String(s.check_interval_hours))
      setEmail(s.notify_email || '')
    })
  }, [])

  async function handleTestEmail() {
    setTesting(true)
    setAlert(null)
    try {
      const res = await api.testEmail()
      setAlert({ type: 'success', msg: `Test email sent to ${res.sent_to}` })
    } catch (err) {
      setAlert({ type: 'error', msg: err.message })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setAlert(null)
    try {
      await api.updateSettings({
        check_interval_hours: parseFloat(interval),
        notify_email: email || undefined,
      })
      setAlert({ type: 'success', msg: 'Settings saved.' })
    } catch (err) {
      setAlert({ type: 'error', msg: err.message })
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return <div className="empty"><p>Loading…</p></div>

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, maxWidth: 540, margin: '0 auto 20px' }}>Settings</h2>

      {alert && <div className={`alert alert-${alert.type}`}>{alert.msg}</div>}

      <div className="card" style={{ maxWidth: 540, margin: '0 auto' }}>
        <form onSubmit={handleSave}>
          <div className="settings-section">
            <h3>Schedule</h3>
            <div className="settings-row">
              <div className="form-group">
                <label>Check interval (hours)</label>
                <select value={interval} onChange={e => setInterval(e.target.value)}>
                  <option value="1">Every 1 hour</option>
                  <option value="2">Every 2 hours</option>
                  <option value="4">Every 4 hours</option>
                  <option value="6">Every 6 hours (default)</option>
                  <option value="12">Every 12 hours</option>
                  <option value="24">Once a day</option>
                </select>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Email Notifications</h3>
            <div
              style={{
                background: settings.smtp_configured ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${settings.smtp_configured ? '#bbf7d0' : '#fde68a'}`,
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                marginBottom: 14,
                color: settings.smtp_configured ? '#166534' : '#92400e',
              }}
            >
              {settings.smtp_configured
                ? '✓ Gmail SMTP is configured via environment variables.'
                : '⚠ Gmail SMTP not configured. Set SMTP_USER and SMTP_PASSWORD in your .env file.'}
            </div>
            {settings.smtp_configured && isAdmin && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleTestEmail}
                disabled={testing}
                style={{ marginBottom: 14 }}
              >
                {testing ? <><span className="spinner" style={{ borderTopColor: '#475569', borderColor: 'rgba(0,0,0,0.1)' }} /> Sending…</> : '✉ Send test email'}
              </button>
            )}
            {isAdmin && (
              <div className="form-group">
                <label>Notify email address</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={{ width: 300 }}
                />
                <span style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  Where to send new job alerts. Defaults to SMTP_USER if blank.
                </span>
              </div>
            )}
          </div>

          {isAdmin && (
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" style={{ borderTopColor: '#fff' }} /> Saving…</> : 'Save settings'}
            </button>
          )}
        </form>
      </div>

      <div className="card" style={{ maxWidth: 540, margin: '16px auto 0' }}>
        <div className="card-title" style={{ marginBottom: 12 }}>Environment Variables</div>
        <p style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>
          Configure these in your <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>.env</code> file:
        </p>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {[
              ['SMTP_USER', 'your.email@gmail.com'],
              ['SMTP_PASSWORD', 'your-app-password'],
              ['NOTIFY_EMAIL', 'recipient@example.com'],
              ['SMTP_HOST', 'smtp.gmail.com'],
              ['SMTP_PORT', '587'],
              ['CHECK_INTERVAL_HOURS', '6'],
            ].map(([key, val]) => (
              <tr key={key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '6px 0', fontFamily: 'monospace', color: '#0f172a' }}>{key}</td>
                <td style={{ padding: '6px 0 6px 12px', color: '#94a3b8' }}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
