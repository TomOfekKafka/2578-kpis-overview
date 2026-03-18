import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { credentialsReady, callMcpTool } from './api';
import './App.css';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApiRow {
  'Reporting Date': number;
  'DR_ACC_L1.5': string;
  'Amount': number;
}

interface PeriodKPIs {
  label: string;
  revenue: number;
  expenses: number;
  netIncome: number;
  grossProfit: number;
  grossMargin: number;
  opExRatio: number;
}

type Aggregation = 'month' | 'quarter' | 'year';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const decodeHtml = (s: string) => {
  const txt = document.createElement('textarea');
  txt.innerHTML = s;
  return txt.value;
};

const fmt = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-US');

const fmtPct = (n: number) => n.toFixed(1) + '%';

const EXPENSE_CATS = new Set(['COGS', 'G&A', 'R&D', 'S&M', 'Finance expenses', 'Tax', 'Other', 'Intercompany']);

function getPeriodLabel(date: Date, agg: Aggregation): string {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (agg === 'month') {
    return date.toLocaleString('en-US', { month: 'short', year: '2-digit' });
  } else if (agg === 'quarter') {
    const q = Math.floor(month / 3) + 1;
    return `Q${q} '${String(year).slice(2)}`;
  } else {
    return String(year);
  }
}

function getPeriodKey(date: Date, agg: Aggregation): string {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (agg === 'month') return `${year}-${String(month + 1).padStart(2, '0')}`;
  if (agg === 'quarter') return `${year}-Q${Math.floor(month / 3) + 1}`;
  return String(year);
}

function aggregateRows(rows: ApiRow[], agg: Aggregation, yearFilter: string): PeriodKPIs[] {
  const now = new Date();
  const buckets = new Map<string, { label: string; revenue: number; cogs: number; expenses: number }>();

  for (const row of rows) {
    const date = new Date(row['Reporting Date'] * 1000);
    if (date > now) continue;

    const year = String(date.getFullYear());
    if (yearFilter !== 'all' && year !== yearFilter) continue;

    const cat = decodeHtml(row['DR_ACC_L1.5']);
    const amount = row['Amount'] ?? 0;

    const key = getPeriodKey(date, agg);
    const label = getPeriodLabel(date, agg);

    if (!buckets.has(key)) {
      buckets.set(key, { label, revenue: 0, cogs: 0, expenses: 0 });
    }
    const b = buckets.get(key)!;

    if (cat === 'Revenues') b.revenue += amount;
    if (cat === 'COGS') b.cogs += amount;
    if (EXPENSE_CATS.has(cat)) b.expenses += amount;
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, b]) => {
      const grossProfit = b.revenue - b.cogs;
      const netIncome = b.revenue - b.expenses;
      const grossMargin = b.revenue !== 0 ? (grossProfit / b.revenue) * 100 : 0;
      const opExRatio = b.revenue !== 0 ? (b.expenses / b.revenue) * 100 : 0;
      return { label: b.label, revenue: b.revenue, expenses: b.expenses, netIncome, grossProfit, grossMargin, opExRatio };
    });
}

// ─── Mock data fallback ───────────────────────────────────────────────────────

function generateMockRows(): ApiRow[] {
  const rows: ApiRow[] = [];
  const baseAmounts: Record<string, number> = {
    Revenues: 2500000, COGS: 600000, 'G&A': 400000, 'R&D': 300000, 'S&M': 350000, 'Finance expenses': 80000,
  };
  for (let y = 2022; y <= 2025; y++) {
    for (let m = 0; m < 12; m++) {
      if (y === 2025 && m > 2) break;
      const lastDay = new Date(y, m + 1, 0);
      const ts = Math.floor(lastDay.getTime() / 1000);
      for (const cat of Object.keys(baseAmounts)) {
        rows.push({
          'Reporting Date': ts,
          'DR_ACC_L1.5': cat,
          'Amount': baseAmounts[cat] * (0.9 + Math.random() * 0.2),
        });
      }
    }
  }
  return rows;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  current: number;
  previous: number;
  isPercent?: boolean;
}

function KpiCard({ title, current, previous, isPercent }: KpiCardProps) {
  const change = previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : 0;
  const up = change >= 0;
  const displayValue = isPercent ? fmtPct(current) : fmt(current);
  const prevDisplay = isPercent ? fmtPct(previous) : fmt(previous);

  return (
    <div className="kpi-card">
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{displayValue}</div>
      <div className="kpi-footer">
        <span className="kpi-prev">Prev: {prevDisplay}</span>
        <span className={`kpi-change ${up ? 'up' : 'down'}`}>
          {up ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [rows, setRows] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agg, setAgg] = useState<Aggregation>('month');
  const [yearFilter, setYearFilter] = useState<string>('all');

  useEffect(() => {
    async function fetchData() {
      try {
        await credentialsReady;
        const tables = await callMcpTool('list_finance_tables', {}) as Array<{ id: number; name: string }>;
        const fin = tables.find(t => /^financials$/i.test(t.name)) ?? tables[0];
        const tableId = String(fin.id);

        const data = await callMcpTool('aggregate_table_data', {
          table_id: tableId,
          dimensions: ['Reporting Date', 'DR_ACC_L1.5'],
          metrics: [{ field: 'Amount', agg: 'SUM' }],
          filters: [
            { name: 'Scenario', values: ['Actuals'], is_excluded: false },
            { name: 'DR_ACC_L0', values: ['P&L'], is_excluded: false },
          ],
        }) as ApiRow[];

        setRows(data);
      } catch (err) {
        console.warn('API error, using mock data:', err);
        setError('Using demo data (API unavailable)');
        setRows(generateMockRows());
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const availableYears = useMemo(() => {
    const now = new Date();
    const years = new Set<string>();
    for (const row of rows) {
      const d = new Date(row['Reporting Date'] * 1000);
      if (d <= now) years.add(String(d.getFullYear()));
    }
    return Array.from(years).sort();
  }, [rows]);

  const periods = useMemo(() => aggregateRows(rows, agg, yearFilter), [rows, agg, yearFilter]);

  const latestPeriod = periods[periods.length - 1];
  const prevPeriod = periods[periods.length - 2];

  const chartData = periods.map(p => ({
    name: p.label,
    Revenue: Math.round(p.revenue),
    Expenses: Math.round(p.expenses),
    'Net Income': Math.round(p.netIncome),
  }));

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading financial data…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>KPIs Overview</h1>
          <span className="header-sub">Financial Performance Dashboard</span>
        </div>
        <div className="header-right">
          {error && <div className="error-banner">{error}</div>}
          <div className="header-controls">
            <select
              className="year-select"
              value={yearFilter}
              onChange={e => setYearFilter(e.target.value)}
            >
              <option value="all">All Years</option>
              {availableYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <div className="agg-toggle">
              {(['month', 'quarter', 'year'] as Aggregation[]).map(a => (
                <button
                  key={a}
                  className={`agg-btn ${agg === a ? 'active' : ''}`}
                  onClick={() => setAgg(a)}
                >
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {latestPeriod && prevPeriod && (
        <section className="kpi-grid">
          <KpiCard title="Total Revenue" current={latestPeriod.revenue} previous={prevPeriod.revenue} />
          <KpiCard title="Total Expenses" current={latestPeriod.expenses} previous={prevPeriod.expenses} />
          <KpiCard title="Net Income" current={latestPeriod.netIncome} previous={prevPeriod.netIncome} />
          <KpiCard title="Gross Margin %" current={latestPeriod.grossMargin} previous={prevPeriod.grossMargin} isPercent />
        </section>
      )}

      <section className="charts-grid">
        <div className="chart-card">
          <h2>Revenue vs Expenses</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={v => {
                  const n = v as number;
                  return '$' + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : (n / 1e3).toFixed(0) + 'K');
                }}
                tick={{ fontSize: 11 }}
              />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Legend />
              <Bar dataKey="Revenue" fill="#4646CE" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Expenses" fill="#f97316" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h2>Net Income Trend</h2>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={v => {
                  const n = v as number;
                  return '$' + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : (n / 1e3).toFixed(0) + 'K');
                }}
                tick={{ fontSize: 11 }}
              />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Legend />
              <Line
                type="monotone"
                dataKey="Net Income"
                stroke="#10b981"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="table-section">
        <h2>Period Breakdown</h2>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Revenue</th>
                <th>Expenses</th>
                <th>Net Income</th>
                <th>Gross Margin %</th>
                <th>OpEx Ratio</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p, i) => (
                <tr key={i} className={i % 2 === 0 ? 'even' : 'odd'}>
                  <td className="period-cell">{p.label}</td>
                  <td>{fmt(p.revenue)}</td>
                  <td>{fmt(p.expenses)}</td>
                  <td className={p.netIncome >= 0 ? 'positive' : 'negative'}>{fmt(p.netIncome)}</td>
                  <td>{fmtPct(p.grossMargin)}</td>
                  <td>{fmtPct(p.opExRatio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
