import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, LineChart } from 'lucide-react';
import type { Lang } from '../i18n/translations';
import { t } from '../i18n/translations';
import { memberFetch } from '../lib/memberSession';
import {
  brokerWallParts,
  brokerWallToUtcMs,
  deviceTimeZone,
  formatOffset,
  partsInTimeZone,
} from '../lib/brokerClock';
import './Management.css';

type AuthHeaders = (json?: boolean) => Record<string, string>;
type TelemetryEvent = {
  kind: string;
  ativo: string;
  brokerTime: string;
  brokerOffsetMin: number;
  profitUsd: number;
  floatUsd: number;
  floatMinUsd: number;
  floatMaxUsd: number;
  balanceUsd: number;
  floatMinBalanceUsd: number;
  closeReason: string;
};
type AccountOption = { numeroConta: string; symbols: string[] };
type StatsResponse = {
  brokerOffsetMin: number | null;
  corretora?: string;
  accounts: AccountOption[];
  account: string;
  symbol: string;
  month: string;
  retentionDays: number;
  events: TelemetryEvent[];
};
type Bucket = {
  hasData: boolean;
  profit: number;
  closes: number;
  floatSum: number;
  floatN: number;
  floatMin: number | null;
  pctSum: number;
  pctN: number;
  drawdown: number | null;
  goalGain: number;
  goalLoss: number;
};
type DayReport = { bucket: Bucket; hours: Bucket[] };

const TZ_KEY = 'fr_mgmt_tz';
const CLOCK_KEY = 'fr_mgmt_clock';
const ZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Fortaleza',
  'America/Noronha',
  'America/New_York',
  'America/Chicago',
  'Europe/Lisbon',
  'Europe/London',
  'Atlantic/Azores',
  'UTC',
];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

function dateKey(year: number, month: number, day: number): string {
  return `${monthKey(year, month)}-${pad(day)}`;
}

function shiftMonth(value: string, delta: number): string {
  const [year, month] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return monthKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

function emptyBucket(): Bucket {
  return {
    hasData: false,
    profit: 0,
    closes: 0,
    floatSum: 0,
    floatN: 0,
    floatMin: null,
    pctSum: 0,
    pctN: 0,
    drawdown: null,
    goalGain: 0,
    goalLoss: 0,
  };
}

function money(value: number, lang: Lang): string {
  return value.toLocaleString(lang === 'es' ? 'es-ES' : 'pt-BR', {
    style: 'currency',
    currency: 'USD',
  });
}

function percent(value: number, lang: Lang): string {
  return `${value.toLocaleString(lang === 'es' ? 'es-ES' : 'pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function drawdownPercent(floatUsd: number, balanceUsd: number): number | null {
  if (!(balanceUsd > 0) || !(floatUsd < 0)) return null;
  return (-floatUsd / balanceUsd) * 100;
}

function signedFloatPercent(floatUsd: number, balanceUsd: number): number | null {
  if (!(balanceUsd > 0)) return null;
  return (floatUsd / balanceUsd) * 100;
}

function rememberWorstFloat(bucket: Bucket, floatUsd: number, balanceUsd: number) {
  if (bucket.floatMin != null && floatUsd >= bucket.floatMin) return;
  bucket.floatMin = floatUsd;
  const dd = drawdownPercent(floatUsd, balanceUsd);
  if (dd != null && (bucket.drawdown == null || dd > bucket.drawdown)) bucket.drawdown = dd;
}

function addEvent(bucket: Bucket, event: TelemetryEvent) {
  bucket.hasData = true;
  if (event.kind === 'close') {
    bucket.profit += event.profitUsd;
    bucket.closes += 1;
    const balance = event.floatMinBalanceUsd > 0 ? event.floatMinBalanceUsd : event.balanceUsd;
    if (event.floatMinUsd !== 0 || event.floatMaxUsd !== 0) {
      rememberWorstFloat(bucket, event.floatMinUsd, balance);
    }
  } else if (event.kind === 'float_sample') {
    bucket.floatSum += event.floatUsd;
    bucket.floatN += 1;
    const signed = signedFloatPercent(event.floatUsd, event.balanceUsd);
    if (signed != null) {
      bucket.pctSum += signed;
      bucket.pctN += 1;
    }
    rememberWorstFloat(bucket, event.floatUsd, event.balanceUsd);
  } else if (event.kind === 'goal_gain') {
    bucket.goalGain += 1;
  } else if (event.kind === 'goal_loss') {
    bucket.goalLoss += 1;
  }
}

export function Management({ lang, authHeaders }: { lang: Lang; authHeaders: AuthHeaders }) {
  const tr = t(lang);
  const dayNames = tr.mgmt_days.split('|');
  const [account, setAccount] = useState('');
  const [symbol, setSymbol] = useState('');
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState<'broker' | 'user'>(() =>
    localStorage.getItem(CLOCK_KEY) === 'user' ? 'user' : 'broker'
  );
  const [timeZone, setTimeZone] = useState(() => localStorage.getItem(TZ_KEY) || deviceTimeZone());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const initialNow = new Date();
  const initialMonth = monthKey(initialNow.getFullYear(), initialNow.getMonth() + 1);
  const [month, setMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState(`${initialMonth}-${pad(initialNow.getDate())}`);

  useEffect(() => localStorage.setItem(CLOCK_KEY, clock), [clock]);
  useEffect(() => localStorage.setItem(TZ_KEY, timeZone), [timeZone]);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ month });
    if (account) params.set('account', account);
    if (symbol) params.set('symbol', symbol);
    setLoading(true);
    memberFetch(`/api/me/robot-stats?${params.toString()}`, { headers: authHeaders() })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: StatsResponse | null) => {
        if (!body) {
          setData({ brokerOffsetMin: null, accounts: [], account: '', symbol: '', month, retentionDays: 120, events: [] });
          return;
        }
        setData(body);
        setAccount(body.account || '');
        setSymbol(body.symbol || '');
      })
      .catch(() => {
        setData({ brokerOffsetMin: null, accounts: [], account: '', symbol: '', month, retentionDays: 120, events: [] });
      })
      .finally(() => setLoading(false));
  }, [month, account, symbol]);

  const zoneOptions = useMemo(
    () => (ZONES.includes(timeZone) ? ZONES : [timeZone, ...ZONES]),
    [timeZone]
  );
  const offset = data?.brokerOffsetMin == null ? null : Math.round(data.brokerOffsetMin / 15) * 15;

  const todayKey = useMemo(() => {
    if (clock === 'user') {
      const parts = partsInTimeZone(nowMs, timeZone);
      return dateKey(parts.year, parts.month, parts.day);
    }
    const brokerNow = new Date(nowMs + (offset || 0) * 60_000);
    return dateKey(brokerNow.getUTCFullYear(), brokerNow.getUTCMonth() + 1, brokerNow.getUTCDate());
  }, [clock, nowMs, offset, timeZone]);
  const currentMonth = todayKey.slice(0, 7);
  const oldestMonth = useMemo(() => {
    const oldest = new Date(nowMs - (data?.retentionDays || 120) * 24 * 60 * 60 * 1000);
    return monthKey(oldest.getUTCFullYear(), oldest.getUTCMonth() + 1);
  }, [data?.retentionDays, nowMs]);

  const report = useMemo(() => {
    const days = new Map<string, DayReport>();
    for (const event of data?.events || []) {
      const broker = brokerWallParts(event.brokerTime);
      if (!broker) continue;
      let parts = broker;
      if (clock === 'user') {
        const utc = brokerWallToUtcMs(event.brokerTime, event.brokerOffsetMin);
        if (utc == null) continue;
        parts = partsInTimeZone(utc, timeZone);
      }
      const key = dateKey(parts.year, parts.month, parts.day);
      if (!key.startsWith(`${month}-`)) continue;
      let day = days.get(key);
      if (!day) {
        day = { bucket: emptyBucket(), hours: Array.from({ length: 24 }, emptyBucket) };
        days.set(key, day);
      }
      addEvent(day.bucket, event);
      addEvent(day.hours[parts.hour], event);
    }
    const monthBucket = emptyBucket();
    let positiveDays = 0;
    let negativeDays = 0;
    for (const day of days.values()) {
      monthBucket.hasData ||= day.bucket.hasData;
      monthBucket.profit += day.bucket.profit;
      monthBucket.closes += day.bucket.closes;
      if (day.bucket.floatMin != null) {
        if (monthBucket.floatMin == null || day.bucket.floatMin < monthBucket.floatMin) {
          monthBucket.floatMin = day.bucket.floatMin;
        }
      }
      if (day.bucket.drawdown != null && (monthBucket.drawdown == null || day.bucket.drawdown > monthBucket.drawdown)) {
        monthBucket.drawdown = day.bucket.drawdown;
      }
      if (day.bucket.closes > 0 && day.bucket.profit > 0) positiveDays += 1;
      if (day.bucket.closes > 0 && day.bucket.profit < 0) negativeDays += 1;
    }
    return { days, monthBucket, positiveDays, negativeDays };
  }, [clock, data, month, timeZone]);

  useEffect(() => {
    if (selectedDate.startsWith(`${month}-`)) return;
    if (todayKey.startsWith(`${month}-`)) {
      setSelectedDate(todayKey);
      return;
    }
    const activeDays = [...report.days.keys()].sort();
    setSelectedDate(activeDays[activeDays.length - 1] || `${month}-01`);
  }, [month, report.days, selectedDate, todayKey]);

  const liveClocks = useMemo(() => {
    const locale = lang === 'es' ? 'es-ES' : 'pt-BR';
    const brokerDate = offset == null ? null : new Date(nowMs + offset * 60_000);
    return {
      brokerTime: brokerDate ? `${pad(brokerDate.getUTCHours())}:${pad(brokerDate.getUTCMinutes())}` : '—',
      brokerDate: brokerDate ? `${pad(brokerDate.getUTCDate())}/${pad(brokerDate.getUTCMonth() + 1)}` : '—',
      userTime: new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(nowMs)),
      userDate: new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(nowMs)),
    };
  }, [lang, nowMs, offset, timeZone]);

  const calendar = useMemo(() => {
    const [year, monthNumber] = month.split('-').map(Number);
    const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - firstWeekday + 1;
      return day >= 1 && day <= daysInMonth ? day : null;
    });
  }, [month]);

  const monthLabel = useMemo(() => {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  }, [lang, month]);
  const selectedLabel = useMemo(() => {
    const [year, monthNumber, day] = selectedDate.split('-').map(Number);
    return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, monthNumber - 1, day)));
  }, [lang, selectedDate]);

  const selected = report.days.get(selectedDate) || {
    bucket: emptyBucket(),
    hours: Array.from({ length: 24 }, emptyBucket),
  };
  const symbols = data?.accounts.find((item) => item.numeroConta === (account || data?.account))?.symbols || [];

  return (
    <div className="mgmt-page">
      <header className="mgmt-hero">
        <div className="mgmt-hero-icon" aria-hidden><LineChart size={22} /></div>
        <div><h1>{tr.mgmt_title}</h1><p>{tr.mgmt_intro}</p></div>
      </header>

      <div className="mgmt-toolbar">
        <label>{tr.mgmt_account}
          <select value={account} onChange={(event) => { setSymbol(''); setAccount(event.target.value); }}>
            {(data?.accounts || []).map((item) => <option key={item.numeroConta} value={item.numeroConta}>{item.numeroConta}</option>)}
          </select>
        </label>
        <label>{tr.mgmt_symbol}
          <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
            {symbols.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      <section className="mgmt-clock">
        <div className="mgmt-clock-head"><span className="mgmt-clock-badge" aria-hidden><Clock3 size={18} /></span><h2>{tr.mgmt_convert_title}</h2></div>
        <p className="mgmt-note">{tr.mgmt_convert_hint}{offset != null ? ` ${tr.mgmt_offset} ${formatOffset(offset)}${data?.corretora ? ` · ${data.corretora}` : ''}.` : ''}</p>
        <div className="mgmt-clock-controls">
          <label>{tr.mgmt_tz_label}
            <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
              {zoneOptions.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
          </label>
          <div className="mgmt-clock-actions">
            <button type="button" className="mgmt-linkish" onClick={() => setTimeZone(deviceTimeZone())}>{tr.mgmt_use_device}</button>
            <div className="mgmt-pills">
              <button type="button" className={clock === 'broker' ? 'active' : ''} onClick={() => setClock('broker')}>{tr.mgmt_clock_broker}</button>
              <button type="button" className={clock === 'user' ? 'active' : ''} onClick={() => setClock('user')}>{tr.mgmt_clock_mine}</button>
            </div>
          </div>
        </div>
        <div className="mgmt-convert-grid">
          <div className="mgmt-live-clock"><span>{tr.mgmt_broker_time}</span><strong>{liveClocks.brokerTime}</strong><small>{liveClocks.brokerDate} · {offset == null ? tr.mgmt_waiting_sync : formatOffset(offset)}</small></div>
          <div className="mgmt-live-clock"><span>{tr.mgmt_my_time}</span><strong>{liveClocks.userTime}</strong><small>{liveClocks.userDate} · {timeZone}</small></div>
        </div>
      </section>

      {loading && !data ? <p className="mgmt-state">{tr.mgmt_loading}</p> : !(data?.accounts.length) ? <p className="mgmt-state">{tr.mgmt_empty}</p> : (
        <>
          <section className="mgmt-month">
            <div className="mgmt-month-nav">
              <div className="mgmt-month-title"><CalendarDays size={20} /><h2>{monthLabel}</h2></div>
              <div className="mgmt-month-actions">
                <button type="button" disabled={month <= oldestMonth} aria-label={tr.mgmt_prev_month} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></button>
                <button type="button" disabled={month === currentMonth} onClick={() => setMonth(currentMonth)}>{tr.mgmt_today}</button>
                <button type="button" disabled={month >= currentMonth} aria-label={tr.mgmt_next_month} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={18} /></button>
              </div>
            </div>

            <div className="mgmt-cards mgmt-month-summary">
              <article><span>{tr.mgmt_month_result}</span><strong className={report.monthBucket.profit >= 0 ? 'pos' : 'neg'}>{money(report.monthBucket.profit, lang)}</strong><small>{report.monthBucket.closes} {tr.mgmt_col_trades.toLowerCase()}</small></article>
              <article><span>{tr.mgmt_positive_days}</span><strong>{report.positiveDays}</strong></article>
              <article><span>{tr.mgmt_negative_days}</span><strong>{report.negativeDays}</strong></article>
              <article><span>{tr.mgmt_month_worst_dd}</span><strong className="neg">{report.monthBucket.drawdown != null ? percent(report.monthBucket.drawdown, lang) : '—'}</strong><small>{report.monthBucket.floatMin != null ? money(report.monthBucket.floatMin, lang) : ''}</small></article>
            </div>

            <div className="mgmt-calendar" key={`${month}-${clock}-${timeZone}`}>
              <div className="mgmt-weekdays">{dayNames.map((name) => <span key={name}>{name}</span>)}</div>
              <div className="mgmt-calendar-grid">
                {calendar.map((day, index) => {
                  if (day == null) return <span key={`empty-${index}`} className="mgmt-calendar-empty" />;
                  const key = `${month}-${pad(day)}`;
                  const bucket = report.days.get(key)?.bucket;
                  const status = !bucket?.hasData ? 'no-data' : bucket.closes === 0 ? 'monitored' : bucket.profit > 0 ? 'positive' : bucket.profit < 0 ? 'negative' : 'monitored';
                  return (
                    <button type="button" key={key} className={`mgmt-calendar-day ${status} ${selectedDate === key ? 'selected' : ''} ${todayKey === key ? 'today' : ''}`} onClick={() => setSelectedDate(key)}>
                      <span className="mgmt-day-number">{day}</span>
                      {bucket?.hasData ? (
                        <span className="mgmt-day-metrics">
                          <strong>{bucket.closes ? money(bucket.profit, lang) : tr.mgmt_monitored}</strong>
                          <small>{bucket.drawdown != null ? `${percent(bucket.drawdown, lang)} DD` : '— DD'}</small>
                          <small>{bucket.closes} {tr.mgmt_closes_short}</small>
                        </span>
                      ) : <span className="mgmt-day-metrics"><small>{tr.mgmt_no_data}</small></span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="mgmt-day-detail">
            <div className="mgmt-day-heading"><div><span>{tr.mgmt_selected_day}</span><h2>{selectedLabel}</h2></div><small>{clock === 'broker' ? tr.mgmt_clock_broker : `${tr.mgmt_clock_mine} · ${timeZone}`}</small></div>
            <div className="mgmt-cards mgmt-day-summary">
              <article><span>{tr.mgmt_day_result}</span><strong className={selected.bucket.profit >= 0 ? 'pos' : 'neg'}>{selected.bucket.closes ? money(selected.bucket.profit, lang) : '—'}</strong></article>
              <article><span>{tr.mgmt_col_trades}</span><strong>{selected.bucket.closes}</strong></article>
              <article><span>{tr.mgmt_col_worst}</span><strong className="neg">{selected.bucket.floatMin != null ? money(selected.bucket.floatMin, lang) : '—'}</strong><small>{selected.bucket.drawdown != null ? `${percent(selected.bucket.drawdown, lang)} DD` : ''}</small></article>
              <article><span>{tr.mgmt_goals}</span><strong>{selected.bucket.goalGain} / {selected.bucket.goalLoss}</strong><small>{tr.mgmt_gain_loss}</small></article>
            </div>

            <h2 className="mgmt-table-title">{tr.mgmt_all_hours}</h2>
            <div className="mgmt-table-wrap">
              <table>
                <thead><tr><th>{tr.mgmt_col_hour}</th><th>{tr.mgmt_col_profit}</th><th>{tr.mgmt_col_trades}</th><th>{tr.mgmt_col_float}</th><th>{tr.mgmt_col_worst}</th><th>{tr.mgmt_col_goals_gain}</th><th>{tr.mgmt_col_goals_loss}</th></tr></thead>
                <tbody>
                  {selected.hours.map((bucket, hour) => (
                    <tr key={hour} className={bucket.profit > 0 ? 'row-positive' : bucket.profit < 0 ? 'row-negative' : ''}>
                      <td><span className="mgmt-time-chip">{pad(hour)}:00</span></td>
                      <td className={bucket.profit >= 0 ? 'pos' : 'neg'}>{bucket.closes ? money(bucket.profit, lang) : '—'}</td>
                      <td><span className="mgmt-count-chip">{bucket.closes || '—'}</span></td>
                      <td>{bucket.floatN ? <span className="mgmt-float-cell"><span>{money(bucket.floatSum / bucket.floatN, lang)}</span>{bucket.pctN ? <small>{percent(bucket.pctSum / bucket.pctN, lang)}</small> : null}</span> : '—'}</td>
                      <td className="neg">{bucket.floatMin != null ? <span className="mgmt-float-cell"><span>{money(bucket.floatMin, lang)}</span>{bucket.drawdown != null ? <small>{percent(bucket.drawdown, lang)} DD</small> : null}</span> : '—'}</td>
                      <td>{bucket.goalGain || '—'}</td><td>{bucket.goalLoss || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
