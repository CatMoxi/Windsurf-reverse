import { useState, useEffect, useCallback } from 'react'
import { BarChart3, Users, Upload, RefreshCw, Trash2, Plus, Activity, Server, AlertCircle, CheckCircle2 } from 'lucide-react'

interface Stats {
  total_requests: number
  total_errors: number
  total_accounts: number
  active_accounts: number
}

interface Account {
  id: number
  api_key_masked: string
  email: string
  plan: string
  credits_remaining: number
  status: string
  upstream_url: string
  request_count: number
  error_count: number
  last_used: string | null
  created_at: string
}

type Tab = 'dashboard' | 'accounts' | 'import'

const API = ''

function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [stats, setStats] = useState<Stats | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/stats`)
      setStats(await r.json())
    } catch (e) {
      console.error('Failed to fetch stats', e)
    }
  }, [])

  const fetchAccounts = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/accounts`)
      const data = await r.json()
      setAccounts(data.accounts || [])
    } catch (e) {
      console.error('Failed to fetch accounts', e)
    }
  }, [])

  useEffect(() => {
    fetchStats()
    fetchAccounts()
    const iv = setInterval(() => { fetchStats(); fetchAccounts() }, 10000)
    return () => clearInterval(iv)
  }, [fetchStats, fetchAccounts])

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
          toast.type === 'ok' ? 'bg-emerald-900/90 text-emerald-200' : 'bg-red-900/90 text-red-200'
        }`}>
          {toast.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="text-blue-400" size={24} />
            <h1 className="text-xl font-semibold text-white">Windsurf Proxy</h1>
            <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">v0.1.0</span>
          </div>
          <nav className="flex gap-1">
            {([
              ['dashboard', BarChart3, 'Dashboard'],
              ['accounts', Users, 'Accounts'],
              ['import', Upload, 'Import'],
            ] as const).map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => setTab(id as Tab)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                  tab === id
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {tab === 'dashboard' && <Dashboard stats={stats} onRefresh={fetchStats} />}
        {tab === 'accounts' && (
          <Accounts
            accounts={accounts}
            onRefresh={fetchAccounts}
            showToast={showToast}
            loading={loading}
            setLoading={setLoading}
          />
        )}
        {tab === 'import' && <Import onImported={() => { fetchAccounts(); fetchStats() }} showToast={showToast} />}
      </main>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
      <p className="text-sm text-gray-400 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

function Dashboard({ stats, onRefresh }: { stats: Stats | null; onRefresh: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <button onClick={onRefresh} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {stats ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Requests" value={stats.total_requests} color="text-blue-400" />
          <StatCard label="Errors" value={stats.total_errors} color="text-red-400" />
          <StatCard label="Total Accounts" value={stats.total_accounts} color="text-gray-200" />
          <StatCard label="Active Accounts" value={stats.active_accounts} color="text-emerald-400" />
        </div>
      ) : (
        <p className="text-gray-500">Loading...</p>
      )}

      <div className="mt-8 bg-gray-900/50 border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Quick Setup</h3>
        <div className="space-y-3">
          <CodeBlock title="Claude Code (Anthropic)" code={`set ANTHROPIC_BASE_URL=http://127.0.0.1:8787\nset ANTHROPIC_API_KEY=your-proxy-key\nclaude`} />
          <CodeBlock title="OpenAI Compatible" code={`curl http://127.0.0.1:8787/v1/chat/completions \\\n  -H "Authorization: Bearer your-proxy-key" \\\n  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}'`} />
          <CodeBlock title="Gemini Compatible" code={`curl http://127.0.0.1:8787/v1beta/models/gemini-2.5-pro:generateContent \\\n  -H "x-goog-api-key: your-proxy-key" \\\n  -d '{"contents":[{"parts":[{"text":"hello"}]}]}'`} />
        </div>
      </div>
    </div>
  )
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div>
      <p className="text-sm text-gray-400 mb-1">{title}</p>
      <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm text-green-400 overflow-x-auto whitespace-pre-wrap">{code}</pre>
    </div>
  )
}

function Accounts({
  accounts, onRefresh, showToast, loading, setLoading
}: {
  accounts: Account[]
  onRefresh: () => void
  showToast: (msg: string, type: 'ok' | 'err') => void
  loading: boolean
  setLoading: (v: boolean) => void
}) {
  const [newKey, setNewKey] = useState('')
  const [newEmail, setNewEmail] = useState('')

  const addAccount = async () => {
    if (!newKey.trim()) return
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: newKey.trim(), email: newEmail.trim() }),
      })
      if (r.ok) {
        showToast('Account added', 'ok')
        setNewKey('')
        setNewEmail('')
        onRefresh()
      } else {
        const d = await r.json()
        showToast(d.error || 'Failed', 'err')
      }
    } catch (e) {
      showToast('Network error', 'err')
    }
    setLoading(false)
  }

  const deleteAccount = async (id: number) => {
    if (!confirm('Delete this account?')) return
    try {
      const r = await fetch(`${API}/api/accounts`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (r.ok) {
        showToast('Account deleted', 'ok')
        onRefresh()
      }
    } catch {
      showToast('Failed to delete', 'err')
    }
  }

  const healthCheck = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/health-check`, { method: 'POST' })
      const d = await r.json()
      showToast(`Checked: ${d.checked}, Healthy: ${d.healthy}`, 'ok')
      onRefresh()
    } catch {
      showToast('Health check failed', 'err')
    }
    setLoading(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Accounts ({accounts.length})</h2>
        <div className="flex gap-2">
          <button onClick={healthCheck} disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 bg-amber-900/50 hover:bg-amber-800/50 border border-amber-700/50 rounded-lg text-sm text-amber-300 transition-colors disabled:opacity-50">
            <Activity size={14} /> Health Check
          </button>
          <button onClick={onRefresh}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Add account form */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 mb-6 flex gap-3 items-end">
        <div className="flex-1">
          <label className="text-xs text-gray-400 mb-1 block">API Key</label>
          <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="devin-session-token$..."
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
        </div>
        <div className="w-48">
          <label className="text-xs text-gray-400 mb-1 block">Email (optional)</label>
          <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="user@email.com"
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
        </div>
        <button onClick={addAccount} disabled={loading || !newKey.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white transition-colors disabled:opacity-50">
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Account table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-left">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">API Key</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Requests</th>
              <th className="px-4 py-3">Errors</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No accounts. Add one above or use Import.</td></tr>
            ) : (
              accounts.map(a => (
                <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-3 text-gray-400">{a.id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{a.api_key_masked}</td>
                  <td className="px-4 py-3">{a.email || '—'}</td>
                  <td className="px-4 py-3">{a.plan}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                      a.status === 'active' ? 'bg-emerald-900/50 text-emerald-300' :
                      a.status === 'error' ? 'bg-red-900/50 text-red-300' :
                      'bg-gray-800 text-gray-400'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        a.status === 'active' ? 'bg-emerald-400' :
                        a.status === 'error' ? 'bg-red-400' : 'bg-gray-500'
                      }`} />
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{a.request_count}</td>
                  <td className="px-4 py-3 text-gray-300">{a.error_count}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => deleteAccount(a.id)}
                      className="p-1 text-gray-500 hover:text-red-400 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Import({ onImported, showToast }: { onImported: () => void; showToast: (msg: string, type: 'ok' | 'err') => void }) {
  const [data, setData] = useState('')
  const [loading, setLoading] = useState(false)

  const doImport = async () => {
    if (!data.trim()) return
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/accounts/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: data.trim() }),
      })
      const d = await r.json()
      if (r.ok) {
        showToast(`Imported: ${d.added} added, ${d.skipped} skipped (${d.parsed} parsed)`, 'ok')
        setData('')
        onImported()
      } else {
        showToast(d.error || 'Import failed', 'err')
      }
    } catch {
      showToast('Network error', 'err')
    }
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Import Accounts</h2>
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
        <p className="text-sm text-gray-400 mb-4">
          Paste accounts in any format. Auto-detected: <strong>JSON array</strong>, <strong>CSV</strong>, <strong>ENV</strong>, or <strong>one key per line</strong>.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-500 mb-2">JSON example:</p>
            <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-400">
{`[
  {"api_key": "key1", "email": "a@b.com"},
  {"key": "key2"}
]`}
            </pre>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-2">CSV example:</p>
            <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-400">
{`api_key,email
key1,a@b.com
key2,c@d.com`}
            </pre>
          </div>
        </div>
        <textarea
          value={data}
          onChange={e => setData(e.target.value)}
          rows={8}
          placeholder="Paste accounts here..."
          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 font-mono focus:outline-none focus:border-blue-500 resize-y"
        />
        <button onClick={doImport} disabled={loading || !data.trim()}
          className="mt-4 flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white font-medium transition-colors disabled:opacity-50">
          <Upload size={16} /> {loading ? 'Importing...' : 'Import'}
        </button>
      </div>
    </div>
  )
}

export default App
