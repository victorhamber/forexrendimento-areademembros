import { useEffect, useMemo, useState } from 'react';
import { Clock3, LineChart } from 'lucide-react';
import type { Lang } from '../i18n/translations';
import { t } from '../i18n/translations';
import { memberFetch } from '../lib/memberSession';
import {
  brokerWallParts,
  brokerWallToUtcMs,
  convertBrokerClockToZone,
  convertZoneClockToBroker,
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
  closeReason: string;
};

type AccountOption = { numeroConta: string; symbols: string[] };

type StatsResponse = {
  brokerOffsetMin: number | null;
  corretora?: string;
  accounts: AccountOption[];
  account: string;
  symbol: string;
  days: number;
  events: TelemetryEvent[];
};

const PERIODS = [7, 15, 30, 90] as const;
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

type Bucket = {
  profit: number;
  closes: number;
  floatSum: number;
  floatN: number;
  floatMin: number | null;
  goalGain: number;
  goalLoss: number;
};

function emptyBucket(): Bucket {
  return { profit: 0, closes: 0, floatSum: 0, floatN: 0, floatMin: null, goalGain: 0, goalLoss: 0 };
}

function money(value: number, lang: Lang): string {
  return value.toLocaleString(lang === 'es' ? 'es-ES' : 'pt-BR', {
    style: 'currency',
    currency: 'USD',
  });
}

function parseHm(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function Management({
  lang,
  authHeaders,
}: {
  lang: Lang;
  authHeaders: AuthHeaders;
}) {
  const tr = t(lang);
  const dayNames = tr.mgmt_days.split('|');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(30);
  const [account, setAccount] = useState('');
  const [symbol, setSymbol] = useState('');
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState<'broker' | 'user'>(() =>
    localStorage.getItem(CLOCK_KEY) === 'user' ? 'user' : 'broker'
  );
  const [timeZone, setTimeZone] = useState(() => localStorage.getItem(TZ_KEY) || deviceTimeZone());
  const [fromBroker, setFromBroker] = useState('10:00');
  const [fromMine, setFromMine] = useState('10:00');

  useEffect(() => {
    localStorage.setItem(CLOCK_KEY, clock);
  }, [clock]);

  useEffect(() => {
    localStorage.setItem(TZ_KEY, timeZone);
  }, [timeZone]);

  useEffect(() => {
    const params = new URLSearchParams({ days: String(period) });
    if (account) params.set('account', account);
    if (symbol) params.set('symbol', symbol);
    setLoading(true);
    memberFetch(`/api/me/robot-stats?${params.toString()}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: StatsResponse | null) => {
        if (!body) {
          setData({ brokerOffsetMin: null, accounts: [], account: '', symbol: '', days: period, events: [] });
          return;
        }
        setData(body);
        setAccount(body.account || '');
        setSymbol(body.symbol || '');
      })
      .catch(() => {
        setData({ brokerOffsetMin: null, accounts: [], account: '', symbol: '', days: period, events: [] });
      })
      .finally(() => setLoading(false));
  }, [period, account, symbol]);

  const zoneOptions = useMemo(() => {
    const list = ZONES.includes(timeZone) ? ZONES : [timeZone, ...ZONES];
    return list;
  }, [timeZone]);

  const offset = data?.brokerOffsetMin;

  const report = useMemo(() => {
    const hours = Array.from({ length: 24 }, emptyBucket);
    const days = Array.from({ length: 7 }, emptyBucket);
    const events = data?.events || [];
    for (const ev of events) {
      const broker = brokerWallParts(ev.brokerTime);
      if (!broker) continue;
      let hour = broker.hour;
      let dow = broker.dow;
      if (clock === 'user' && offset != null) {
        const utc = brokerWallToUtcMs(ev.brokerTime, ev.brokerOffsetMin);
        if (utc == null) continue;
        const parts = partsInTimeZone(utc, timeZone);
        hour = parts.hour;
        dow = parts.dow;
      }
      const hourBucket = hours[hour];
      const dayBucket = days[dow];
      if (!hourBucket || !dayBucket) continue;

      if (ev.kind === 'close') {
        hourBucket.profit += ev.profitUsd;
        hourBucket.closes += 1;
        dayBucket.profit += ev.profitUsd;
        dayBucket.closes += 1;
        if (ev.floatMinUsd !== 0 || ev.floatMaxUsd !== 0) {
          hourBucket.floatMin = hourBucket.floatMin == null
            ? ev.floatMinUsd
            : Math.min(hourBucket.floatMin, ev.floatMinUsd);
          dayBucket.floatMin = dayBucket.floatMin == null
            ? ev.floatMinUsd
            : Math.min(dayBucket.floatMin, ev.floatMinUsd);
        }
      } else if (ev.kind === 'float_sample') {
        hourBucket.floatSum += ev.floatUsd;
        hourBucket.floatN += 1;
        hourBucket.floatMin = hourBucket.floatMin == null
          ? ev.floatUsd
          : Math.min(hourBucket.floatMin, ev.floatUsd);
        dayBucket.floatSum += ev.floatUsd;
        dayBucket.floatN += 1;
        dayBucket.floatMin = dayBucket.floatMin == null
          ? ev.floatUsd
          : Math.min(dayBucket.floatMin, ev.floatUsd);
      } else if (ev.kind === 'goal_gain') {
        hourBucket.goalGain += 1;
        dayBucket.goalGain += 1;
      } else if (ev.kind === 'goal_loss') {
        hourBucket.goalLoss += 1;
        dayBucket.goalLoss += 1;
      }
    }

    const withCloses = hours
      .map((bucket, hour) => ({ hour, bucket }))
      .filter((row) => row.bucket.closes > 0);
    const bestHour = withCloses.reduce<(typeof withCloses)[number] | null>(
      (best, row) => (!best || row.bucket.profit > best.bucket.profit ? row : best),
      null
    );
    const withFloat = hours
      .map((bucket, hour) => ({ hour, bucket }))
      .filter((row) => row.bucket.floatMin != null);
    const stressHour = withFloat.reduce<(typeof withFloat)[number] | null>(
      (worst, row) => (!worst || (row.bucket.floatMin ?? 0) < (worst.bucket.floatMin ?? 0) ? row : worst),
      null
    );
    const calmHour = withFloat
      .filter((row) => row.bucket.floatN > 0)
      .reduce<(typeof withFloat)[number] | null>((calm, row) => {
        const avg = Math.abs(row.bucket.floatSum / row.bucket.floatN);
        if (!calm || calm.bucket.floatN === 0) return row;
        const calmAvg = Math.abs(calm.bucket.floatSum / calm.bucket.floatN);
        return avg < calmAvg ? row : calm;
      }, null);
    const withDays = days
      .map((bucket, dow) => ({ dow, bucket }))
      .filter((row) => row.bucket.closes > 0);
    const bestDay = withDays.reduce<(typeof withDays)[number] | null>(
      (best, row) => (!best || row.bucket.profit > best.bucket.profit ? row : best),
      null
    );

    return { hours, days, bestHour, bestDay, stressHour, calmHour };
  }, [data, clock, offset, timeZone]);

  const brokerToMine = useMemo(() => {
    const hm = parseHm(fromBroker);
    if (!hm || offset == null) return '—';
    return convertBrokerClockToZone(hm.hour, hm.minute, offset, timeZone);
  }, [fromBroker, offset, timeZone]);

  const mineToBroker = useMemo(() => {
    const hm = parseHm(fromMine);
    if (!hm || offset == null) return '—';
    return convertZoneClockToBroker(hm.hour, hm.minute, offset, timeZone);
  }, [fromMine, offset, timeZone]);

  const symbols = data?.accounts.find((item) => item.numeroConta === (account || data?.account))?.symbols || [];
  const hasEvents = (data?.events.length || 0) > 0;

  return (
    <div className="mgmt-page">
      <header className="mgmt-hero">
        <div className="mgmt-hero-icon" aria-hidden>
          <LineChart size={22} />
        </div>
        <div>
          <h1>{tr.mgmt_title}</h1>
          <p>{tr.mgmt_intro}</p>
        </div>
      </header>

      <div className="mgmt-toolbar">
        <label>
          {tr.mgmt_account}
          <select value={account} onChange={(e) => { setSymbol(''); setAccount(e.target.value); }}>
            {(data?.accounts || []).map((item) => (
              <option key={item.numeroConta} value={item.numeroConta}>{item.numeroConta}</option>
            ))}
          </select>
        </label>
        <label>
          {tr.mgmt_symbol}
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {symbols.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className="mgmt-pills" role="group" aria-label={tr.mgmt_period}>
          {PERIODS.map((item) => (
            <button
              key={item}
              type="button"
              className={period === item ? 'active' : ''}
              onClick={() => setPeriod(item)}
            >
              {item}d
            </button>
          ))}
        </div>
      </div>

      <section className="mgmt-clock">
        <div className="mgmt-clock-head">
          <Clock3 size={18} aria-hidden />
          <h2>{tr.mgmt_convert_title}</h2>
        </div>
        <p className="mgmt-note">
          {tr.mgmt_convert_hint}
          {offset != null ? ` ${tr.mgmt_offset} ${formatOffset(offset)}${data?.corretora ? ` · ${data.corretora}` : ''}.` : ''}
        </p>
        <div className="mgmt-clock-controls">
          <label>
            {tr.mgmt_tz_label}
            <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              {zoneOptions.map((zone) => (
                <option key={zone} value={zone}>{zone}</option>
              ))}
            </select>
          </label>
          <button type="button" className="mgmt-linkish" onClick={() => setTimeZone(deviceTimeZone())}>
            {tr.mgmt_use_device}
          </button>
          <div className="mgmt-pills">
            <button type="button" className={clock === 'broker' ? 'active' : ''} onClick={() => setClock('broker')}>
              {tr.mgmt_clock_broker}
            </button>
            <button type="button" className={clock === 'user' ? 'active' : ''} onClick={() => setClock('user')}>
              {tr.mgmt_clock_mine}
            </button>
          </div>
        </div>
        <div className="mgmt-convert-grid">
          <label>
            {tr.mgmt_broker_time}
            <input type="time" value={fromBroker} onChange={(e) => setFromBroker(e.target.value)} />
            <span>{tr.mgmt_becomes} <strong>{brokerToMine}</strong> {tr.mgmt_in_my_zone}</span>
          </label>
          <label>
            {tr.mgmt_my_time}
            <input type="time" value={fromMine} onChange={(e) => setFromMine(e.target.value)} />
            <span>{tr.mgmt_becomes} <strong>{mineToBroker}</strong> {tr.mgmt_in_broker}</span>
          </label>
        </div>
      </section>

      {loading ? (
        <p className="mgmt-state">{tr.mgmt_loading}</p>
      ) : !hasEvents ? (
        <p className="mgmt-state">{tr.mgmt_empty}</p>
      ) : (
        <>
          <div className="mgmt-cards">
            <article>
              <span>{tr.mgmt_best_hour}</span>
              <strong>{report.bestHour ? `${String(report.bestHour.hour).padStart(2, '0')}:00` : '—'}</strong>
              <small>{report.bestHour ? money(report.bestHour.bucket.profit, lang) : ''}</small>
            </article>
            <article>
              <span>{tr.mgmt_best_day}</span>
              <strong>{report.bestDay ? dayNames[report.bestDay.dow] : '—'}</strong>
              <small>{report.bestDay ? money(report.bestDay.bucket.profit, lang) : ''}</small>
            </article>
            <article>
              <span>{tr.mgmt_stress_hour}</span>
              <strong>{report.stressHour ? `${String(report.stressHour.hour).padStart(2, '0')}:00` : '—'}</strong>
              <small>{report.stressHour?.bucket.floatMin != null ? money(report.stressHour.bucket.floatMin, lang) : ''}</small>
            </article>
            <article>
              <span>{tr.mgmt_calm_hour}</span>
              <strong>{report.calmHour ? `${String(report.calmHour.hour).padStart(2, '0')}:00` : '—'}</strong>
              <small>
                {report.calmHour && report.calmHour.bucket.floatN > 0
                  ? money(report.calmHour.bucket.floatSum / report.calmHour.bucket.floatN, lang)
                  : ''}
              </small>
            </article>
          </div>

          <h2 className="mgmt-table-title">{tr.mgmt_by_hour}</h2>
          <div className="mgmt-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr.mgmt_col_hour}</th>
                  <th>{tr.mgmt_col_profit}</th>
                  <th>{tr.mgmt_col_trades}</th>
                  <th>{tr.mgmt_col_float}</th>
                  <th>{tr.mgmt_col_worst}</th>
                  <th>{tr.mgmt_col_goals_gain}</th>
                  <th>{tr.mgmt_col_goals_loss}</th>
                </tr>
              </thead>
              <tbody>
                {report.hours.map((bucket, hour) => (
                  <tr key={hour}>
                    <td>{String(hour).padStart(2, '0')}:00</td>
                    <td className={bucket.profit >= 0 ? 'pos' : 'neg'}>{bucket.closes ? money(bucket.profit, lang) : '—'}</td>
                    <td>{bucket.closes || '—'}</td>
                    <td>
                      {bucket.floatN
                        ? money(bucket.floatSum / bucket.floatN, lang)
                        : '—'}
                    </td>
                    <td className="neg">{bucket.floatMin != null ? money(bucket.floatMin, lang) : '—'}</td>
                    <td>{bucket.goalGain || '—'}</td>
                    <td>{bucket.goalLoss || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mgmt-table-title">{tr.mgmt_by_day}</h2>
          <div className="mgmt-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr.mgmt_col_day}</th>
                  <th>{tr.mgmt_col_profit}</th>
                  <th>{tr.mgmt_col_trades}</th>
                  <th>{tr.mgmt_col_worst}</th>
                  <th>{tr.mgmt_col_goals_gain}</th>
                  <th>{tr.mgmt_col_goals_loss}</th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((bucket, dow) => (
                  <tr key={dow}>
                    <td>{dayNames[dow]}</td>
                    <td className={bucket.profit >= 0 ? 'pos' : 'neg'}>{bucket.closes ? money(bucket.profit, lang) : '—'}</td>
                    <td>{bucket.closes || '—'}</td>
                    <td className="neg">{bucket.floatMin != null ? money(bucket.floatMin, lang) : '—'}</td>
                    <td>{bucket.goalGain || '—'}</td>
                    <td>{bucket.goalLoss || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
