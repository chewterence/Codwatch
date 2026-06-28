import { useState, useEffect } from 'react'
import VoyageTimeline from './VoyageTimeline'
import './VesselDetail.css'

const FLAG_EMOJI = {
  Australia:            '🇦🇺',
  Chile:                '🇨🇱',
  China:                '🇨🇳',
  France:               '🇫🇷',
  Japan:                '🇯🇵',
  'Korea, Republic of': '🇰🇷',
  Namibia:              '🇳🇦',
  'New Zealand':        '🇳🇿',
  'Russian Federation': '🇷🇺',
  'South Africa':       '🇿🇦',
  Spain:                '🇪🇸',
  Ukraine:              '🇺🇦',
  'United Kingdom':     '🇬🇧',
  Uruguay:              '🇺🇾',
}

// ISO3 → { emoji, name } for all port_flag values that appear in the database
const PORT_FLAG = {
  AGO: { iso2:'AO', name:'Angola' },
  ARG: { iso2:'AR', name:'Argentina' },
  ATF: { iso2:'TF', name:'French Southern Territories' },
  AUS: { iso2:'AU', name:'Australia' },
  BRA: { iso2:'BR', name:'Brazil' },
  CAN: { iso2:'CA', name:'Canada' },
  CHL: { iso2:'CL', name:'Chile' },
  CHN: { iso2:'CN', name:'China' },
  CIV: { iso2:'CI', name:'Côte d\'Ivoire' },
  COD: { iso2:'CD', name:'DR Congo' },
  CPV: { iso2:'CV', name:'Cape Verde' },
  ESP: { iso2:'ES', name:'Spain' },
  FJI: { iso2:'FJ', name:'Fiji' },
  FLK: { iso2:'FK', name:'Falkland Islands' },
  FRA: { iso2:'FR', name:'France' },
  GBR: { iso2:'GB', name:'United Kingdom' },
  GHA: { iso2:'GH', name:'Ghana' },
  GNB: { iso2:'GW', name:'Guinea-Bissau' },
  IND: { iso2:'IN', name:'India' },
  JPN: { iso2:'JP', name:'Japan' },
  KOR: { iso2:'KR', name:'South Korea' },
  MDG: { iso2:'MG', name:'Madagascar' },
  MOZ: { iso2:'MZ', name:'Mozambique' },
  MRT: { iso2:'MR', name:'Mauritania' },
  MUS: { iso2:'MU', name:'Mauritius' },
  NAM: { iso2:'NA', name:'Namibia' },
  NGA: { iso2:'NG', name:'Nigeria' },
  NOR: { iso2:'NO', name:'Norway' },
  NZL: { iso2:'NZ', name:'New Zealand' },
  PER: { iso2:'PE', name:'Peru' },
  PRT: { iso2:'PT', name:'Portugal' },
  REU: { iso2:'RE', name:'Réunion' },
  RUS: { iso2:'RU', name:'Russia' },
  SEN: { iso2:'SN', name:'Senegal' },
  SGS: { iso2:'GS', name:'South Georgia' },
  SHN: { iso2:'SH', name:'Saint Helena' },
  SYC: { iso2:'SC', name:'Seychelles' },
  TZA: { iso2:'TZ', name:'Tanzania' },
  UKR: { iso2:'UA', name:'Ukraine' },
  URY: { iso2:'UY', name:'Uruguay' },
  USA: { iso2:'US', name:'United States' },
  ZAF: { iso2:'ZA', name:'South Africa' },
}

function portFlagDisplay(iso3) {
  if (!iso3) return { emoji: '', name: iso3 }
  const entry = PORT_FLAG[iso3.toUpperCase()]
  if (!entry) return { emoji: '', name: iso3 }
  const emoji = [...entry.iso2].map(c => String.fromCodePoint(c.charCodeAt(0) + 0x1F1A5)).join('')
  return { emoji, name: entry.name }
}

function fmt(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtHours(h) {
  if (h == null) return '—'
  if (h >= 24) return `${(h / 24).toFixed(1)}d`
  return `${h.toFixed(1)}h`
}

function PortHistoryTable({ ports }) {
  if (!ports.length) {
    return (
      <div className="port-empty">
        <div className="port-empty-title">No port landings recorded in this period</div>
      </div>
    )
  }
  return (
    <table className="port-table">
      <thead>
        <tr>
          <th>Port</th>
          <th>Country</th>
          <th title="Approximate — derived from last loitering event before port call">Approx. Arrival ⓘ</th>
        </tr>
      </thead>
      <tbody>
        {ports.map(p => {
          const { emoji, name } = portFlagDisplay(p.port_flag)
          return (
            <tr key={p.event_id}>
              <td className="port-name">{p.port_name || '—'}</td>
              <td>{p.port_flag ? `${emoji} ${name}` : '—'}</td>
              <td>{fmt(p.start_time)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const RANGES = [
  { months: 6,  label: '6 mo' },
  { months: 12, label: '1 yr' },
  { months: 24, label: '2 yr' },
  { months: 60, label: 'All'  },
]

export default function VesselDetail({ vessel, onBack }) {
  const [months, setMonths] = useState(12)
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!vessel) return
    setLoading(true)
    setData(null)
    fetch(`/api/vessels/${vessel.id}/timeline?months=${months}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
  }, [vessel?.id, months])

  const flag = FLAG_EMOJI[vessel.flag] || '🏳️'

  return (
    <div className="vessel-detail">
      <div className="detail-header">
        <button className="detail-back" onClick={onBack}>← Fleet</button>

        <div className="detail-identity">
          <span className="detail-flag">{flag}</span>
          <span className="detail-name">{vessel.vessel_name}</span>
          <span className="detail-country">{vessel.flag}</span>
        </div>

        <div className="detail-kpis">
          <span title="Fishing events">⚓ {Number(vessel.fishing_event_count).toLocaleString()}</span>
          <span title="Encounters">🤝 {vessel.encounter_count}</span>
          <span title="AIS gaps">📡 {vessel.ais_gap_count}</span>
          {vessel.eleginoides_authorized && <span className="species-pill">D. eleginoides</span>}
          {vessel.mawsoni_authorized     && <span className="species-pill">D. mawsoni</span>}
        </div>

        <div className="detail-range">
          {RANGES.map(r => (
            <button
              key={r.months}
              className={`range-btn ${months === r.months ? 'range-btn--active' : ''}`}
              onClick={() => setMonths(r.months)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="detail-loading">Loading voyage data…</div>
      ) : (
        <>
          <VoyageTimeline
            fishingEvents={data?.fishing_events}
            portVisits={data?.port_visits}
            aisGaps={data?.ais_gaps}
          />
          <div className="port-section">
            <div className="port-section-title">Port Landing History</div>
            <PortHistoryTable ports={data?.port_visits || []} />
          </div>
        </>
      )}
    </div>
  )
}
