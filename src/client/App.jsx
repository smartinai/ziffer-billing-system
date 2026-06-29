import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  Euro,
  FileText,
  Loader2,
  LockKeyhole,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { demoMode, getSession, getSummary, login, logout, refreshSummary } from "./api.js";

const tabs = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "users", label: "People", icon: UsersRound },
  { id: "clients", label: "Clients", icon: BriefcaseBusiness }
];

const disabledNavItems = [
  { id: "ecdf", label: "eCDF", icon: FileText },
  { id: "performance", label: "Performance", icon: Activity }
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

const wholeNumber = new Intl.NumberFormat("en-LU", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0
});

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function BrandLogo({ className = "" }) {
  return <img className={`brand-logo ${className}`} src="/logo-ziffer-new.svg" alt="ZIFFER" />;
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function today() {
  return formatLocalDate(new Date());
}

function lastMonthRange() {
  const date = new Date();
  const first = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const last = new Date(date.getFullYear(), date.getMonth(), 0);
  return {
    endDate: formatLocalDate(last),
    startDate: formatLocalDate(first)
  };
}

function monthRange(period) {
  const [year, month] = period.split("-").map(Number);
  const endDate = `${period}-${padDatePart(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
  return { endDate, startDate: `${period}-01` };
}

function formatMonthOption(period) {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

function selectedMonthPeriod(range) {
  if (!range.startDate || !range.endDate || !range.startDate.endsWith("-01")) return "";
  const period = range.startDate.slice(0, 7);
  return monthRange(period).endDate === range.endDate ? period : "";
}

function dataMonthOptions(yearTrend = []) {
  return yearTrend
    .filter((row) => row.period && ((row.hours || 0) > 0 || (row.billableHours || 0) > 0 || (row.money || 0) > 0))
    .map((row) => ({ label: formatMonthOption(row.period), value: row.period }))
    .sort((a, b) => b.value.localeCompare(a.value));
}

function formatHours(value) {
  return `${decimal.format(value || 0)}h`;
}

function formatWholeHours(value) {
  return `${wholeNumber.format(value || 0)}h`;
}

function formatEntryCount(value) {
  const count = Number(value || 0);
  return `${count} time ${count === 1 ? "entry" : "entries"}`;
}

function formatPeopleCount(value) {
  const count = Number(value || 0);
  return `${count} ${count === 1 ? "person" : "people"}`;
}

function detailCardId(row, scope = "project") {
  return `${scope}-detail-${String(row.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
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
          Time, billed hours, and project value from Teamwork in one focused local dashboard.
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

function PeriodSelector({ demo, monthOptions, range, setRange, onRefresh, refreshing }) {
  const selectedMonth = selectedMonthPeriod(range);

  return (
    <div className="period-toolbar">
      <div className="preset-group" aria-label="Period presets">
        <button onClick={() => setRange(lastMonthRange())} type="button">Last month</button>
      </div>
      <label className="month-field">
        <span className="sr-only">Select data month</span>
        <select
          aria-label="Select data month"
          disabled={!monthOptions.length}
          onChange={(event) => {
            if (event.target.value) setRange(monthRange(event.target.value));
          }}
          value={monthOptions.some((option) => option.value === selectedMonth) ? selectedMonth : ""}
        >
          <option disabled={monthOptions.length > 0} hidden={monthOptions.length > 0} value="">
            {monthOptions.length ? "Select month" : "No data months"}
          </option>
          {monthOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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
      <button
        className="refresh-button"
        disabled={refreshing || demo}
        onClick={onRefresh}
        title={demo ? "Demo data is bundled into this Netlify build" : "Sync Teamwork"}
        type="button"
      >
        <RefreshCw className={refreshing ? "spin" : ""} size={17} />
        {demo ? "Demo data" : "Sync Teamwork"}
      </button>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">
        <Icon size={20} />
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function Overview({ report }) {
  const totals = report?.totals || {};
  const byProject = report?.byProject || [];
  const byUser = report?.byUser || [];
  const yearTrend = report?.yearTrend || [];
  const chartYear = yearTrend[0]?.year || report?.period?.endDate?.slice(0, 4) || "";

  return (
    <>
      <section className="metric-grid">
        <MetricCard icon={Clock3} label="Total hours" value={formatWholeHours(totals.hours)} detail="All internal time" />
        <MetricCard
          icon={Clock3}
          label="Billed hours"
          value={formatWholeHours(totals.billableHours)}
          detail={`${totals.billablePercent || 0}% billed`}
        />
        <MetricCard
          icon={BarChart3}
          label="Billed share"
          value={`${totals.billablePercent || 0}%`}
          detail="Billed over total"
        />
        <MetricCard icon={Euro} label="Amounts" value={currency.format(totals.money || 0)} detail="Person-rate amount" />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p>Year overview</p>
              <h2>Billed by month</h2>
            </div>
            <span>{chartYear}</span>
          </div>
          <ResponsiveContainer height={280} width="100%">
            <BarChart data={yearTrend} margin={{ bottom: 0, left: 0, right: 18, top: 14 }}>
              <CartesianGrid stroke="#e6e1da" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#606060", fontSize: 12 }} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#606060", fontSize: 12 }}
                tickFormatter={(value) => compactCurrency.format(value)}
              />
              <Tooltip
                contentStyle={{ border: "1px solid #dfd8c8", borderRadius: 8 }}
                formatter={(value) => [currency.format(value), "Billed"]}
                labelFormatter={(label) => `${label} ${chartYear}`}
              />
              <Bar
                dataKey="money"
                fill="#4f959e"
                isAnimationActive={false}
                name="Billed"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </section>

      <section className="two-column">
        <DataTable title="Top projects" rows={byProject.slice(0, 7)} mode="projects" />
        <DataTable title="Top people" rows={byUser.slice(0, 7)} mode="users" />
      </section>
    </>
  );
}

function DataTable({ mode, rows, title }) {
  const isUsers = mode === "users";
  const [expandedRowId, setExpandedRowId] = useState("");

  useEffect(() => {
    if (expandedRowId && !rows.some((row) => row.id === expandedRowId)) {
      setExpandedRowId("");
    }
  }, [expandedRowId, rows]);

  return (
    <article className="panel table-panel">
      <div className="panel-heading">
        <div>
          <p>{isUsers ? "People" : "Project clients"}</p>
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
              <th>Billed</th>
              <th>Amounts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const detailScope = isUsers ? "person" : "project";
              const expanded = expandedRowId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className={`drilldown-table-row ${expanded ? "expanded" : ""}`}>
                    <td>
                      <button
                        aria-controls={detailCardId(row, detailScope)}
                        aria-expanded={expanded}
                        className="project-row-button"
                        onClick={() => setExpandedRowId(expanded ? "" : row.id)}
                        type="button"
                      >
                        {isUsers ? (
                          <UserIdentity user={row} meta={`${row.projectCount || 0} projects`} />
                        ) : (
                          <>
                            <strong>{row.name}</strong>
                            <span>{`${formatPeopleCount(row.userCount)} | ${formatEntryCount(row.entryCount)}`}</span>
                          </>
                        )}
                      </button>
                    </td>
                    <td>{formatHours(row.totals.hours)}</td>
                    <td>{formatHours(row.totals.billableHours)}</td>
                    <td>{currency.format(row.totals.money)}</td>
                  </tr>
                  {expanded ? (
                    <tr className="project-detail-row overview-detail-row">
                      <td colSpan="4">
                        {isUsers ? <PersonProjectsCard person={row} /> : <ProjectPeopleCard project={row} />}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
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
          <h3>Top billed amounts</h3>
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
        <div className="empty-chart">No billed amounts for this period.</div>
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
      <PeopleAmountChart rows={rows} />
      <div className="table-toolbar">
        <div className="table-toolbar-heading">
          <p>Internal people</p>
          <h2>People performance</h2>
        </div>
        <label className="search-field">
          <Search size={16} />
          <input placeholder="Search people" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
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

function ProjectPeopleCard({ project }) {
  const people = project.peopleBreakdown || [];

  return (
    <article className="project-people-card" id={detailCardId(project)}>
      <div className="project-people-card-heading">
        <div>
          <p>People involved</p>
          <h3>{project.name}</h3>
        </div>
        <span>{`${people.length} ${people.length === 1 ? "person" : "people"}`}</span>
      </div>
      {people.length ? (
        <div className="project-people-table-wrap">
          <table className="project-people-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Total hours</th>
                <th>Billed</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td>
                    <UserIdentity user={person} meta={formatEntryCount(person.entryCount)} />
                  </td>
                  <td>{formatHours(person.totals.hours)}</td>
                  <td>{formatHours(person.totals.billableHours)}</td>
                  <td>{currency.format(person.totals.money)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-chart">No people for this period.</div>
      )}
    </article>
  );
}

function PersonProjectsCard({ person }) {
  const projects = person.projectBreakdown || [];

  return (
    <article className="project-people-card" id={detailCardId(person, "person")}>
      <div className="project-people-card-heading">
        <div>
          <p>Projects worked on</p>
          <h3>{person.name}</h3>
        </div>
        <span>{`${projects.length} ${projects.length === 1 ? "project" : "projects"}`}</span>
      </div>
      {projects.length ? (
        <div className="project-people-table-wrap">
          <table className="project-people-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Total hours</th>
                <th>Billed</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <div className="project-breakdown-name">
                      <strong>{project.name}</strong>
                      <span>{formatEntryCount(project.entryCount)}</span>
                    </div>
                  </td>
                  <td>{formatHours(project.totals.hours)}</td>
                  <td>{formatHours(project.totals.billableHours)}</td>
                  <td>{currency.format(project.totals.money)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-chart">No projects for this period.</div>
      )}
    </article>
  );
}

function DetailTable({ rows, type }) {
  const isUsers = type === "users";
  const [expandedRowId, setExpandedRowId] = useState("");

  useEffect(() => {
    if (expandedRowId && !rows.some((row) => row.id === expandedRowId)) {
      setExpandedRowId("");
    }
  }, [expandedRowId, rows]);

  return (
    <div className="table-wrap">
      <table className="detail-table">
        <thead>
          <tr>
            <th>{isUsers ? "Person" : "Client/project"}</th>
            {isUsers ? <th>Projects</th> : null}
            <th>Total hours</th>
            <th>Billed</th>
            <th>Billed %</th>
            <th>{isUsers ? "Rate" : "People"}</th>
            <th>Amounts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedRowId === row.id;
            const detailScope = isUsers ? "person" : "project";
            return (
              <Fragment key={row.id}>
                <tr className={`drilldown-table-row ${expanded ? "expanded" : ""}`}>
                  <td>
                    {isUsers ? (
                      <button
                        aria-controls={detailCardId(row, detailScope)}
                        aria-expanded={expanded}
                        className="project-row-button"
                        onClick={() => setExpandedRowId(expanded ? "" : row.id)}
                        type="button"
                      >
                        <UserIdentity user={row} meta={row.email} />
                      </button>
                    ) : (
                      <button
                        aria-controls={detailCardId(row, detailScope)}
                        aria-expanded={expanded}
                        className="project-row-button"
                        onClick={() => setExpandedRowId(expanded ? "" : row.id)}
                        type="button"
                      >
                        <strong>{row.name}</strong>
                        <span>{formatEntryCount(row.entryCount)}</span>
                      </button>
                    )}
                  </td>
                  {isUsers ? <td>{row.projectCount || 0}</td> : null}
                  <td>{formatHours(row.totals.hours)}</td>
                  <td>{formatHours(row.totals.billableHours)}</td>
                  <td>{row.totals.billablePercent}%</td>
                  <td>{isUsers ? currency.format(row.rate || 0) : row.userCount || 0}</td>
                  <td>{currency.format(row.totals.money)}</td>
                </tr>
                {expanded ? (
                  <tr className="project-detail-row">
                    <td colSpan={isUsers ? 7 : 6}>
                      {isUsers ? <PersonProjectsCard person={row} /> : <ProjectPeopleCard project={row} />}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={isUsers ? 7 : 6} className="empty-cell">No rows for this period.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Shell({ onLogout, user }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [range, setRange] = useState({ endDate: today(), startDate: "2026-01-01" });
  const [report, setReport] = useState(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const monthOptions = useMemo(() => dataMonthOptions(report?.yearTrend), [report?.yearTrend]);

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
    if (demoMode) return;
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
    <main className={`app-shell ${railCollapsed ? "rail-collapsed" : ""}`}>
      <aside className="side-rail">
        <div>
          <div className="brand-block">
            <BrandLogo className="brand-logo-rail" />
            <button
              aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={railCollapsed}
              className="rail-toggle"
              onClick={() => setRailCollapsed((current) => !current)}
              title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              type="button"
            >
              {railCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
          <nav aria-label="Main navigation">
            <div className="nav-section billing-nav-section">
              <div className="nav-parent" title="Billing">
                <Euro size={18} />
                <span className="nav-label">Billing</span>
              </div>
              <div className="nav-submenu" aria-label="Billing">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      className={`nav-subitem ${activeTab === tab.id ? "active" : ""}`}
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      title={tab.label}
                      type="button"
                    >
                      <Icon size={17} />
                      <span className="nav-label">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="nav-section nav-disabled-section" aria-label="Unavailable sections">
              {disabledNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button className="nav-disabled" disabled key={item.id} title={`${item.label} unavailable`} type="button">
                    <Icon size={17} />
                    <span className="nav-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
        <div className="rail-footer">
          <UserRound size={18} />
          <span className="rail-user-name">{user?.name || "admin"}</span>
          {demoMode ? null : (
            <button aria-label="Sign out" onClick={onLogout} type="button">
              <LogOut size={17} />
            </button>
          )}
        </div>
      </aside>

      <section className="main-surface">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{activeTab === "overview" ? "Overview" : activeTab === "users" ? "People" : "Clients"}</h1>
          </div>
          <PeriodSelector
            demo={demoMode}
            monthOptions={monthOptions}
            range={range}
            refreshing={refreshing}
            setRange={setRange}
            onRefresh={handleRefresh}
          />
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
    if (demoMode) return;
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
