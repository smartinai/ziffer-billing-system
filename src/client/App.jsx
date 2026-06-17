import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  Euro,
  Loader2,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { getSession, getSummary, login, logout, refreshSummary } from "./api.js";

const tabs = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "users", label: "People", icon: UsersRound },
  { id: "clients", label: "Clients", icon: BriefcaseBusiness }
];

const currency = new Intl.NumberFormat("en-LU", {
  currency: "EUR",
  maximumFractionDigits: 0,
  style: "currency"
});

const compactCurrency = new Intl.NumberFormat("en-LU", {
  currency: "EUR",
  maximumFractionDigits: 1,
  notation: "compact",
  style: "currency"
});

const decimal = new Intl.NumberFormat("en-LU", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0
});

function BrandLogo({ className = "" }) {
  return <img className={`brand-logo ${className}`} src="/logo-ziffer-new.svg" alt="ZIFFER" />;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastMonthRange() {
  const date = new Date();
  const first = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const last = new Date(date.getFullYear(), date.getMonth(), 0);
  return {
    endDate: last.toISOString().slice(0, 10),
    startDate: first.toISOString().slice(0, 10)
  };
}

function formatHours(value) {
  return `${decimal.format(value || 0)}h`;
}

function formatDate(value) {
  if (!value) return "Not synced";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  }).format(new Date(value));
}

function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function UserIdentity({ user, meta }) {
  const [imageFailed, setImageFailed] = useState(false);
  const avatarUrl = user.avatarUrl && !user.avatarUrl.includes("noPhoto") ? user.avatarUrl : "";
  const showImage = avatarUrl && !imageFailed;

  return (
    <div className="user-identity">
      <span className="avatar-circle" aria-hidden="true">
        {showImage ? <img src={avatarUrl} alt="" onError={() => setImageFailed(true)} /> : initials(user.name)}
      </span>
      <span className="identity-copy">
        <strong>{user.name}</strong>
        <span>{meta}</span>
      </span>
    </div>
  );
}

function LoginScreen({ onAuthenticated }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(username, password);
      onAuthenticated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <BrandLogo className="brand-logo-login" />
        <h1>Reporting for precise client work.</h1>
        <p>
          Time, billable hours, and project value from Teamwork in one focused local dashboard.
        </p>
      </section>

      <form className="login-panel" onSubmit={handleSubmit}>
        <LockKeyhole size={22} />
        <div>
          <h2>Admin access</h2>
          <p>Temporary local account for the first reporting build.</p>
        </div>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button" disabled={loading} type="submit">
          {loading ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
          Sign in
        </button>
      </form>
    </main>
  );
}

function PeriodSelector({ range, setRange, onRefresh, refreshing }) {
  function applyPreset(preset) {
    if (preset === "month") setRange({ endDate: today(), startDate: startOfMonth() });
    if (preset === "last") setRange(lastMonthRange());
    if (preset === "april") setRange({ endDate: today(), startDate: "2026-04-01" });
  }

  return (
    <div className="period-toolbar">
      <div className="preset-group" aria-label="Period presets">
        <button onClick={() => applyPreset("month")} type="button">This month</button>
        <button onClick={() => applyPreset("last")} type="button">Last month</button>
        <button onClick={() => applyPreset("april")} type="button">Since Apr 1</button>
      </div>
      <label className="date-field">
        <CalendarDays size={16} />
        <input
          value={range.startDate}
          onChange={(event) => setRange((current) => ({ ...current, startDate: event.target.value }))}
          type="date"
        />
      </label>
      <label className="date-field">
        <input
          value={range.endDate}
          onChange={(event) => setRange((current) => ({ ...current, endDate: event.target.value }))}
          type="date"
        />
      </label>
      <button className="refresh-button" disabled={refreshing} onClick={onRefresh} type="button">
        <RefreshCw className={refreshing ? "spin" : ""} size={17} />
        Sync Teamwork
      </button>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone }) {
  return (
    <article className={`metric-card ${tone || ""}`}>
      <div className="metric-icon">
        <Icon size={20} />
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function StatusPanel({ report, error }) {
  const warnings = report?.metadata?.api?.warnings || [];
  const storageWarnings = report?.metadata?.storage?.warnings || [];
  const missingRates = report?.metadata?.missingRates || [];
  const hasIssues = error || warnings.length || storageWarnings.length || missingRates.length || report?.metadata?.api?.partial;

  return (
    <aside className={`status-panel ${hasIssues ? "attention" : ""}`}>
      <div>
        <span className="status-dot" />
        <p>Stored Teamwork data</p>
      </div>
      <strong>{error ? "Needs attention" : "Stored data"}</strong>
      <span>{error || `Last sync ${formatDate(report?.metadata?.fetchedAt)}`}</span>
      {report?.metadata?.storage?.coverageStart ? (
        <small>
          Coverage {report.metadata.storage.coverageStart} to {report.metadata.storage.coverageEnd}
        </small>
      ) : null}
      {missingRates.length ? <small>{missingRates.length} user rate missing</small> : null}
      {warnings.map((warning) => (
        <small key={warning}>{warning}</small>
      ))}
      {storageWarnings.map((warning) => (
        <small key={warning}>{warning}</small>
      ))}
    </aside>
  );
}

function Overview({ report }) {
  const totals = report?.totals || {};
  const byProject = report?.byProject || [];
  const byUser = report?.byUser || [];

  return (
    <>
      <section className="metric-grid">
        <MetricCard icon={Clock3} label="Total hours" value={formatHours(totals.hours)} detail="All internal time" />
        <MetricCard
          icon={Clock3}
          label="Billable hours"
          value={formatHours(totals.billableHours)}
          detail={`${totals.billablePercent || 0}% billable`}
          tone="warm"
        />
        <MetricCard
          icon={BarChart3}
          label="Billable share"
          value={`${totals.billablePercent || 0}%`}
          detail="Billable over total"
        />
        <MetricCard icon={Euro} label="Amounts" value={currency.format(totals.money || 0)} detail="User-rate amount" tone="dark" />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p>Weekly value</p>
              <h2>Billing trend</h2>
            </div>
            <span>{report?.metadata?.entryCount || 0} entries</span>
          </div>
          <ResponsiveContainer height={280} width="100%">
            <AreaChart data={report?.trend || []} margin={{ bottom: 0, left: 0, right: 18, top: 14 }}>
              <defs>
                <linearGradient id="money" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#4f959e" stopOpacity={0.34} />
                  <stop offset="95%" stopColor="#4f959e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e6e1da" vertical={false} />
              <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: "#606060", fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "#606060", fontSize: 12 }} />
              <Tooltip contentStyle={{ border: "1px solid #dfd8c8", borderRadius: 8 }} />
              <Area
                activeDot={{ fill: "#141414", r: 4, stroke: "#4f959e", strokeWidth: 2 }}
                dataKey="money"
                fill="url(#money)"
                isAnimationActive={false}
                name="Amount"
                stroke="#47858d"
                strokeWidth={3}
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        </article>

        <StatusPanel report={report} />
      </section>

      <section className="two-column">
        <DataTable title="Top projects" rows={byProject.slice(0, 7)} mode="projects" />
        <DataTable title="Top people" rows={byUser.slice(0, 7)} mode="users" />
      </section>
    </>
  );
}

function DataTable({ mode, rows, title }) {
  return (
    <article className="panel table-panel">
      <div className="panel-heading">
        <div>
          <p>{mode === "users" ? "People" : "Project clients"}</p>
          <h2>{title}</h2>
        </div>
        <span>{rows.length} shown</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{mode === "users" ? "Person" : "Client/project"}</th>
              <th>Hours</th>
              <th>Billable</th>
              <th>Amounts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {mode === "users" ? (
                    <UserIdentity user={row} meta={`${row.projectCount || 0} projects`} />
                  ) : (
                    <>
                      <strong>{row.name}</strong>
                      <span>{row.companyName || "No company"}</span>
                    </>
                  )}
                </td>
                <td>{formatHours(row.totals.hours)}</td>
                <td>{formatHours(row.totals.billableHours)}</td>
                <td>{currency.format(row.totals.money)}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan="4" className="empty-cell">No rows for this period.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function PeopleAmountChart({ rows }) {
  const chartRows = useMemo(
    () =>
      rows
        .filter((row) => row.totals.money > 0)
        .slice(0, 12)
        .map((row) => ({
          amount: row.totals.money,
          id: row.id,
          name: row.name
        })),
    [rows]
  );
  const chartHeight = Math.max(250, Math.min(460, chartRows.length * 38 + 54));

  return (
    <div className="people-amount-chart">
      <div className="people-chart-heading">
        <div>
          <p>Amounts by person</p>
          <h3>Top billable amounts</h3>
        </div>
        <span>{chartRows.length ? `${chartRows.length} people shown` : "No amounts"}</span>
      </div>
      {chartRows.length ? (
        <ResponsiveContainer height={chartHeight} width="100%">
          <BarChart data={chartRows} layout="vertical" margin={{ bottom: 8, left: 8, right: 28, top: 8 }}>
            <CartesianGrid horizontal={false} stroke="#e6e1da" />
            <XAxis
              axisLine={false}
              tick={{ fill: "#606060", fontSize: 12 }}
              tickFormatter={(value) => compactCurrency.format(value)}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              dataKey="name"
              tick={{ fill: "#292620", fontSize: 12 }}
              tickLine={false}
              type="category"
              width={150}
            />
            <Tooltip
              contentStyle={{ border: "1px solid #dfd8c8", borderRadius: 8 }}
              formatter={(value) => [currency.format(value), "Amount"]}
            />
            <Bar dataKey="amount" fill="#4f959e" isAnimationActive={false} name="Amount" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="empty-chart">No billable amounts for this period.</div>
      )}
    </div>
  );
}

function PeopleView({ rows }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase())),
    [query, rows]
  );

  return (
    <section className="panel full-panel">
      <div className="panel-heading">
        <div>
          <p>Internal people</p>
          <h2>People performance</h2>
        </div>
        <label className="search-field">
          <Search size={16} />
          <input placeholder="Search people" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <PeopleAmountChart rows={filtered} />
      <DetailTable rows={filtered} type="users" />
    </section>
  );
}

function ClientsView({ rows }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase())),
    [query, rows]
  );

  return (
    <section className="panel full-panel">
      <div className="panel-heading">
        <div>
          <p>Projects as clients</p>
          <h2>Client reporting</h2>
        </div>
        <label className="search-field">
          <Search size={16} />
          <input placeholder="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <DetailTable rows={filtered} type="clients" />
    </section>
  );
}

function DetailTable({ rows, type }) {
  return (
    <div className="table-wrap">
      <table className="detail-table">
        <thead>
          <tr>
            <th>{type === "users" ? "Person" : "Client/project"}</th>
            <th>{type === "users" ? "Projects" : "Company"}</th>
            <th>Total hours</th>
            <th>Billable</th>
            <th>Billable %</th>
            <th>{type === "users" ? "Rate" : "Users"}</th>
            <th>Amounts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                {type === "users" ? (
                  <UserIdentity user={row} meta={row.email} />
                ) : (
                  <>
                    <strong>{row.name}</strong>
                    <span>{`${row.recentEntries?.length || 0} recent entries`}</span>
                  </>
                )}
              </td>
              <td>{type === "users" ? row.projectCount || 0 : row.companyName || "No company"}</td>
              <td>{formatHours(row.totals.hours)}</td>
              <td>{formatHours(row.totals.billableHours)}</td>
              <td>{row.totals.billablePercent}%</td>
              <td>{type === "users" ? currency.format(row.rate || 0) : row.userCount || 0}</td>
              <td>{currency.format(row.totals.money)}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan="7" className="empty-cell">No rows for this period.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Shell({ onLogout, user }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [range, setRange] = useState({ endDate: today(), startDate: "2026-04-01" });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function loadSummary(nextRange = range) {
    setLoading(true);
    setError("");
    try {
      setReport(await getSummary(nextRange));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError("");
    try {
      setReport(await refreshSummary(range));
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadSummary(range);
  }, [range.startDate, range.endDate]);

  return (
    <main className="app-shell">
      <aside className="side-rail">
        <div>
          <div className="brand-block">
            <BrandLogo className="brand-logo-rail" />
          </div>
          <nav>
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  className={activeTab === tab.id ? "active" : ""}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  <Icon size={18} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="rail-footer">
          <UserRound size={18} />
          <span>{user?.name || "admin"}</span>
          <button aria-label="Sign out" onClick={onLogout} type="button">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <section className="main-surface">
        <header className="topbar">
          <div>
            <p>Stored Teamwork reporting</p>
            <h1>{activeTab === "overview" ? "Billing overview" : activeTab === "users" ? "People" : "Clients"}</h1>
          </div>
          <PeriodSelector range={range} refreshing={refreshing} setRange={setRange} onRefresh={handleRefresh} />
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {loading && !report ? (
          <div className="loading-state">
            <Loader2 className="spin" size={28} />
            <span>Loading stored Teamwork reporting data</span>
          </div>
        ) : (
          <div className="content-stack">
            {activeTab === "overview" ? <Overview report={report} /> : null}
            {activeTab === "users" ? <PeopleView rows={report?.byUser || []} /> : null}
            {activeTab === "clients" ? <ClientsView rows={report?.byClient || []} /> : null}
          </div>
        )}
      </section>
    </main>
  );
}

export function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  async function refreshSession() {
    const nextSession = await getSession();
    setSession(nextSession);
  }

  async function handleLogout() {
    await logout();
    setSession({ authenticated: false });
  }

  useEffect(() => {
    refreshSession().finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <main className="loading-state full-page">
        <Loader2 className="spin" size={28} />
        <span>Opening ZIFFER reporting</span>
      </main>
    );
  }

  if (!session?.authenticated) {
    return <LoginScreen onAuthenticated={refreshSession} />;
  }

  return <Shell onLogout={handleLogout} user={session.user} />;
}
