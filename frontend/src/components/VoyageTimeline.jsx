import { useMemo } from 'react'
import { portFlagDisplay } from '../flags'
import './VoyageTimeline.css'

const GAP_THRESHOLD_DAYS = 10

function daysBetween(start, end) {
  if (!start || !end) return 0
  return Math.max(0, (new Date(end) - new Date(start)) / 86400000)
}

// "0d" reads as if nothing happened — a 2-hour encounter or fishing event
// rounds down to zero days. Fall back to hours whenever the day count would
// round to zero, so short segments still show a meaningful duration.
function fmtDurationLabel(start, end) {
  const hours = Math.max(0, (new Date(end) - new Date(start)) / 3600000)
  const days  = Math.round(hours / 24)
  return days > 0 ? `${days}d` : `${Math.round(hours)}h`
}

function fmtShort(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

// Drops the repeated "month year" on the end date when both dates fall in the
// same month — "8 → 9 Nov 24" instead of "8 Nov 24 → 9 Nov 24" — so short
// segments (a single day or two) don't need to wrap to fit their card.
function fmtRange(startIso, endIso) {
  if (!startIso) return ''
  if (!endIso) return fmtShort(startIso)

  const start = new Date(startIso)
  const end   = new Date(endIso)

  // Same calendar day (start/end differ only by time-of-day, e.g. an event
  // that starts and ends a few hours apart on one day) — a single date reads
  // correctly; "30 → 30 June 26" doesn't.
  const sameDay = start.getFullYear() === end.getFullYear() &&
                  start.getMonth()    === end.getMonth() &&
                  start.getDate()     === end.getDate()
  if (sameDay) return fmtShort(startIso)

  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  if (sameMonth) {
    return `${start.getDate()} → ${fmtShort(endIso)}`
  }
  return `${fmtShort(startIso)} → ${fmtShort(endIso)}`
}

const ENCOUNTER_CLUSTER_HOURS = 24

// Nearby encounters (e.g. two meetings with the same buddy boat a few hours
// apart) collapse into one visual cluster instead of fragmenting the
// timeline into a run of near-identical back-to-back encounter blocks.
// Encounters further apart than the threshold become separate clusters —
// i.e. separate blocks in the rendered sequence.
function clusterEncounters(encounters) {
  const sorted = [...encounters].sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
  const clusters = []
  for (const enc of sorted) {
    const last = clusters[clusters.length - 1]
    if (last) {
      const gapHours = (new Date(enc.start_time) - new Date(last.end)) / 3600000
      if (gapHours <= ENCOUNTER_CLUSTER_HOURS) {
        last.items.push(enc)
        const encEnd = enc.end_time || enc.start_time
        if (encEnd > last.end) last.end = encEnd
        continue
      }
    }
    clusters.push({ start: enc.start_time, end: enc.end_time || enc.start_time, items: [enc] })
  }
  return clusters
}

// Splits a merged fishing period into fishing-sub-blocks interleaved with
// encounter blocks at the right point in time — the underlying "trip"
// grouping (what counts as one continuous period) is untouched; this only
// changes how that one period is chopped up for rendering. Uses the
// period's own constituent events (attached in buildSegments) so each
// sub-block gets accurate event_count/total_hours/fao_areas, not a guess.
function splitFishingByEncounters(seg, clusters) {
  if (!clusters.length) return [seg]

  const events     = seg.events || []
  const boundaries = clusters.map(c => new Date(c.start))
  const buckets     = Array.from({ length: boundaries.length + 1 }, () => [])

  for (const e of events) {
    const t = new Date(e.start_time)
    let idx = 0
    while (idx < boundaries.length && t >= boundaries[idx]) idx++
    buckets[idx].push(e)
  }

  const result = []
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i]
    if (bucket.length) {
      let start = bucket[0].start_time
      let end   = bucket[0].end_time || bucket[0].start_time
      const fao = []
      let totalHours = 0
      for (const e of bucket) {
        const eEnd = e.end_time || e.start_time
        if (e.start_time < start) start = e.start_time
        if (eEnd > end) end = eEnd
        totalHours += e.duration_hours || 0
        ;(e.fao_areas || []).forEach(a => { if (!fao.includes(a)) fao.push(a) })
      }
      result.push({ type: 'fishing', start, end, fao_areas: fao, event_count: bucket.length, total_hours: totalHours })
    }
    if (i < clusters.length) {
      result.push({ type: 'encounter', start: clusters[i].start, end: clusters[i].end, encounters: clusters[i].items })
    }
  }
  return result
}

// Same idea as splitFishingByEncounters, but for a transit gap — there's no
// underlying event list to redistribute, just a date range to slice at each
// encounter cluster.
function splitTransitByEncounters(seg, clusters) {
  if (!clusters.length) return [seg]

  const result = []
  let cursor = seg.start
  for (const cluster of clusters) {
    const gapDays = daysBetween(cursor, cluster.start)
    if (gapDays >= 1) {
      result.push({ type: 'transit', start: cursor, end: cluster.start, days: Math.round(gapDays) })
    }
    result.push({ type: 'encounter', start: cluster.start, end: cluster.end, encounters: cluster.items })
    cursor = cluster.end
  }
  const remDays = daysBetween(cursor, seg.end)
  if (remDays >= 1) {
    result.push({ type: 'transit', start: cursor, end: seg.end, days: Math.round(remDays) })
  }
  return result
}

// Walks the built segment sequence and, for fishing/transit segments,
// breaks out any overlapping encounters into their own blocks in the right
// chronological spot. Ports and the isolated "latest" block stay atomic
// (a port call is already a single instant; "latest" is always one event) —
// they keep their encounters as an inline tag list instead.
function applyEncounterSplits(segments, encounters) {
  if (!encounters?.length) return segments

  const result = []
  for (const seg of segments) {
    if (!seg.start || !seg.end) { result.push(seg); continue }

    const segStart = new Date(seg.start)
    const segEnd   = new Date(seg.end)
    const overlapping = encounters.filter(enc => {
      const t = new Date(enc.start_time)
      return t >= segStart && t <= segEnd
    })

    if (!overlapping.length) { result.push(seg); continue }

    if (seg.type === 'fishing') {
      result.push(...splitFishingByEncounters(seg, clusterEncounters(overlapping)))
    } else if (seg.type === 'transit') {
      result.push(...splitTransitByEncounters(seg, clusterEncounters(overlapping)))
    } else {
      result.push({ ...seg, encounters: overlapping })
    }
  }
  return result
}

function formatFaoAreas(areas) {
  if (!areas?.length) return null
  const subareas = [...new Set(areas.filter(a => a.includes('.')))].sort()
  const display = subareas.length ? subareas : [...new Set(areas)].sort()
  return display.slice(0, 3).join(' · ')
}

function buildSegments(fishingEvents, portVisits) {
  if (!fishingEvents.length) return []

  const allPorts = [...(portVisits || [])].sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

  // The single most recent event (fishing or port, whichever is later) is
  // pulled out of normal merging and rendered as its own isolated block at
  // the very end — otherwise it silently vanishes into a multi-day,
  // multi-event period with nothing marking it as the latest known contact.
  const candidates = [
    ...fishingEvents.map(e => ({ kind: 'fishing', ref: e, time: e.end_time || e.start_time })),
    ...allPorts.map(p => ({ kind: 'port', ref: p, time: p.end_time || p.start_time })),
  ]
  const latest = candidates.reduce((a, b) => (new Date(b.time) > new Date(a.time) ? b : a))

  const events = latest.kind === 'fishing' ? fishingEvents.filter(e => e !== latest.ref) : fishingEvents
  const ports  = latest.kind === 'port'    ? allPorts.filter(p => p !== latest.ref)     : allPorts

  const periods = []
  for (const e of events) {
    const eEnd = e.end_time || e.start_time
    if (!periods.length) {
      periods.push({
        type: 'fishing',
        start: e.start_time,
        end: eEnd,
        fao_areas: [...(e.fao_areas || [])],
        event_count: 1,
        total_hours: e.duration_hours || 0,
        events: [e],
      })
    } else {
      const last = periods[periods.length - 1]
      const gap = daysBetween(last.end, e.start_time)
      // A port call between two fishing events always forces a split, even
      // across a short gap — otherwise a quick resupply run gets silently
      // absorbed into one long "continuous fishing" block.
      const portBetween = ports.some(p => p.start_time > last.end && p.start_time <= e.start_time)
      if (gap <= GAP_THRESHOLD_DAYS && !portBetween) {
        if (eEnd > last.end) last.end = eEnd
        last.event_count++
        last.total_hours += e.duration_hours || 0
        last.events.push(e)
        ;(e.fao_areas || []).forEach(a => {
          if (!last.fao_areas.includes(a)) last.fao_areas.push(a)
        })
      } else {
        periods.push({
          type: 'fishing',
          start: e.start_time,
          end: eEnd,
          fao_areas: [...(e.fao_areas || [])],
          event_count: 1,
          total_hours: e.duration_hours || 0,
          events: [e],
        })
      }
    }
  }

  const segments = []
  for (let i = 0; i < periods.length; i++) {
    if (i > 0) {
      const gapStart = periods[i - 1].end
      const gapEnd   = periods[i].start
      const gapDays  = daysBetween(gapStart, gapEnd)

      const gapPorts = ports
        .filter(p => p.start_time >= gapStart && p.start_time <= gapEnd)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

      if (gapPorts.length) {
        let cursor = gapStart
        for (const port of gapPorts) {
          const tDays = daysBetween(cursor, port.start_time)
          if (tDays >= 1) {
            segments.push({ type: 'transit', start: cursor, end: port.start_time, days: Math.round(tDays) })
          }
          segments.push({
            type: 'port',
            start: port.start_time,
            end: port.end_time || port.start_time,
            days: Math.max(1, Math.round(daysBetween(port.start_time, port.end_time || port.start_time))),
            port_name: port.port_name,
            port_flag: port.port_flag,
          })
          cursor = port.end_time || port.start_time
        }
        const remDays = daysBetween(cursor, gapEnd)
        if (remDays >= 1) {
          segments.push({ type: 'transit', start: cursor, end: gapEnd, days: Math.round(remDays) })
        }
      } else {
        segments.push({ type: 'transit', start: gapStart, end: gapEnd, days: Math.round(gapDays) })
      }
    }
    segments.push(periods[i])
  }

  // Bridge from the last regular segment to the isolated latest event.
  const latestStart = latest.ref.start_time
  if (segments.length) {
    const prevEnd  = segments[segments.length - 1].end
    const gapDays  = daysBetween(prevEnd, latestStart)
    if (gapDays >= 1) {
      segments.push({ type: 'transit', start: prevEnd, end: latestStart, days: Math.round(gapDays) })
    }
  }

  if (latest.kind === 'fishing') {
    const e = latest.ref
    segments.push({
      type: 'latest-fishing',
      start: e.start_time,
      end: e.end_time || e.start_time,
      fao_areas: [...(e.fao_areas || [])],
      event_count: 1,
      total_hours: e.duration_hours || 0,
    })
  } else {
    const p = latest.ref
    segments.push({
      type: 'latest-port',
      start: p.start_time,
      end: p.end_time || p.start_time,
      days: Math.max(1, Math.round(daysBetween(p.start_time, p.end_time || p.start_time))),
      port_name: p.port_name,
      port_flag: p.port_flag,
    })
  }

  return segments
}

// Measures rendered text width so segment cards can be sized to fit their
// own date string — duration alone (days * px) isn't enough for short trips
// with long date ranges (e.g. a 1-day segment spanning a month boundary).
let _measureCanvas = null
function measureTextWidth(text, font) {
  if (!_measureCanvas) _measureCanvas = document.createElement('canvas')
  const ctx = _measureCanvas.getContext('2d')
  ctx.font = font
  return ctx.measureText(text).width
}

const DATES_FONT     = '500 12px Inter, system-ui, -apple-system, sans-serif'
const CARD_H_PADDING = 24  // .seg { padding: 10px 12px } — left + right
const WIDTH_BUFFER   = 6   // safety margin against subpixel/font-metric drift
const LATEST_MIN     = 160 // header row (icon + label + LATEST badge) needs more room than dates alone

const ENCOUNTER_MAX_LINES = 4

// Repeat meetings with the same vessel (e.g. a long-running trawler pair)
// collapse into one "×N" line instead of ballooning the card's height, and
// the list is capped so an unusually social segment doesn't run on forever.
function collapseEncounterNames(encounters) {
  const counts = new Map()
  for (const e of encounters) {
    const name = e.encountered_vessel_name || 'Unidentified vessel'
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  const entries  = [...counts.entries()]
  const shown    = entries.slice(0, ENCOUNTER_MAX_LINES)
  const overflow = entries.length - shown.length
  return { shown, overflow }
}

// Encounters attached to a port/latest block (which stay atomic — see
// applyEncounterSplits) render as compact amber lines — same color/meaning
// as the carrier markers on the fleet map and the "Transshipment / port
// offload" legend in EventsPanel. Rendered inline (wraps naturally) rather
// than as a hover tooltip so it stays visible without depending on mouse
// position or clipping against the scroll track.
function EncounterTag({ encounters }) {
  if (!encounters?.length) return null
  const { shown, overflow } = collapseEncounterNames(encounters)

  return (
    <div className="seg-encounter">
      {shown.map(([name, count]) => (
        <div key={name} className="seg-encounter-line">
          🚢 {name}{count > 1 ? ` ×${count}` : ''}
        </div>
      ))}
      {overflow > 0 && (
        <div className="seg-encounter-line seg-encounter-more">
          +{overflow} more vessel{overflow > 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}

function blockWidth(seg, dateText) {
  const days = seg.days ?? daysBetween(seg.start, seg.end)
  const MIN = seg.type === 'transit' ? 72 : 110
  const durationWidth = Math.max(MIN, Math.round(days * 4.5))
  const textWidth = Math.ceil(measureTextWidth(dateText, DATES_FONT)) + CARD_H_PADDING + WIDTH_BUFFER
  return Math.max(durationWidth, textWidth)
}

function FishingBlock({ seg }) {
  const area = formatFaoAreas(seg.fao_areas)
  const dateText = fmtRange(seg.start, seg.end)
  return (
    <div className="seg seg--fishing" style={{ width: blockWidth(seg, dateText) }}>
      <div className="seg-header">
        <span className="seg-icon">🎣</span>
        <span className="seg-type-label">FISHING</span>
      </div>
      <div className="seg-dates">{dateText}</div>
      <div className="seg-days">{fmtDurationLabel(seg.start, seg.end)}</div>
      {area && <div className="seg-area">{area}</div>}
      <div className="seg-sub">{seg.event_count} events · {Math.round(seg.total_hours)}h</div>
      <EncounterTag encounters={seg.encounters} />
    </div>
  )
}

function TransitBlock({ seg }) {
  const dateText = fmtShort(seg.start)
  return (
    <div className="seg seg--transit" style={{ width: blockWidth(seg, dateText) }}>
      <div className="seg-type-label seg-type-label--transit">TRANSIT</div>
      <div className="seg-dates">{dateText}</div>
      <div className="seg-days seg-days--transit">{seg.days}d</div>
      <EncounterTag encounters={seg.encounters} />
    </div>
  )
}

function PortBlock({ seg }) {
  const dateText = fmtShort(seg.start)
  return (
    <div className="seg seg--port" style={{ width: blockWidth(seg, dateText) }}>
      <div className="seg-header">
        <span className="seg-icon">⚓</span>
        <span className="seg-type-label">PORT</span>
      </div>
      <div className="seg-dates">{dateText}</div>
      <div className="seg-days seg-days--port">{seg.days}d</div>
      {seg.port_name && <div className="seg-area">{seg.port_name}</div>}
      {seg.port_flag && (
        <div className="seg-sub">{portFlagDisplay(seg.port_flag).emoji} {portFlagDisplay(seg.port_flag).name}</div>
      )}
      <EncounterTag encounters={seg.encounters} />
    </div>
  )
}

// A vessel-to-vessel meeting broken out of its surrounding fishing/transit
// period into its own block — see applyEncounterSplits. Lighter orange than
// PORT so the two "catch leaves the vessel here" moments (offload at sea vs.
// landed at port) read as related but distinct.
function EncounterBlock({ seg }) {
  const dateText = fmtRange(seg.start, seg.end)
  const { shown, overflow } = collapseEncounterNames(seg.encounters || [])
  return (
    <div className="seg seg--encounter" style={{ width: blockWidth(seg, dateText) }}>
      <div className="seg-header">
        <span className="seg-icon">🚢</span>
        <span className="seg-type-label seg-type-label--encounter">ENCOUNTER</span>
      </div>
      <div className="seg-dates">{dateText}</div>
      <div className="seg-days seg-days--encounter">{fmtDurationLabel(seg.start, seg.end)}</div>
      <div className="seg-encounter">
        {shown.map(([name, count]) => (
          <div key={name} className="seg-encounter-line">
            🚢 {name}{count > 1 ? ` ×${count}` : ''}
          </div>
        ))}
        {overflow > 0 && (
          <div className="seg-encounter-line seg-encounter-more">
            +{overflow} more vessel{overflow > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

// The single most recent event in the whole timeline — same content as a
// regular fishing/port block, but purple, so it reads as "this is the latest
// known contact" rather than just another trip.
function LatestBlock({ seg }) {
  const isPort = seg.type === 'latest-port'
  const durationLabel = isPort ? `${seg.days}d` : fmtDurationLabel(seg.start, seg.end)
  const area = !isPort ? formatFaoAreas(seg.fao_areas) : null
  const dateText = isPort ? fmtShort(seg.start) : fmtRange(seg.start, seg.end)
  const width = Math.max(blockWidth(seg, dateText), LATEST_MIN)
  return (
    <div className="seg seg--latest" style={{ width }}>
      <div className="seg-header">
        <span className="seg-icon">{isPort ? '⚓' : '🎣'}</span>
        <span className="seg-type-label seg-type-label--latest">{isPort ? 'PORT' : 'FISHING'}</span>
        <span className="seg-latest-badge">LATEST</span>
      </div>
      <div className="seg-dates">{dateText}</div>
      <div className="seg-days seg-days--latest">{durationLabel}</div>
      {isPort ? (
        <>
          {seg.port_name && <div className="seg-area seg-area--latest">{seg.port_name}</div>}
          {seg.port_flag && (
            <div className="seg-sub">{portFlagDisplay(seg.port_flag).emoji} {portFlagDisplay(seg.port_flag).name}</div>
          )}
        </>
      ) : (
        <>
          {area && <div className="seg-area seg-area--latest">{area}</div>}
          <div className="seg-sub">{seg.event_count} event{seg.event_count > 1 ? 's' : ''} · {Math.round(seg.total_hours)}h</div>
        </>
      )}
      <EncounterTag encounters={seg.encounters} />
    </div>
  )
}

function Segment({ seg }) {
  if (seg.type === 'fishing')   return <FishingBlock seg={seg} />
  if (seg.type === 'transit')   return <TransitBlock seg={seg} />
  if (seg.type === 'port')      return <PortBlock seg={seg} />
  if (seg.type === 'encounter') return <EncounterBlock seg={seg} />
  if (seg.type === 'latest-fishing' || seg.type === 'latest-port') return <LatestBlock seg={seg} />
  return null
}

export default function VoyageTimeline({ fishingEvents, portVisits, encounters }) {
  // Built once from the raw fishing/port data — this is the "trip" grouping
  // (what counts as one continuous fishing period) and never changes based
  // on encounters, so header stats (trips/days) are always computed from
  // this, not from the encounter-split render list below.
  const rawSegments = useMemo(
    () => buildSegments(fishingEvents || [], portVisits || []),
    [fishingEvents, portVisits],
  )
  // Render-only: breaks fishing/transit segments into sub-blocks around any
  // encounters that fall within them (see applyEncounterSplits) — a purely
  // visual finer breakdown of the same underlying trips.
  const segments = useMemo(
    () => applyEncounterSplits(rawSegments, encounters || []),
    [rawSegments, encounters],
  )

  if (!fishingEvents?.length) {
    return <div className="timeline-empty">No fishing events recorded in this period.</div>
  }

  const fishSegs    = rawSegments.filter(s => s.type === 'fishing' || s.type === 'latest-fishing')
  const transitSegs = rawSegments.filter(s => s.type === 'transit')
  const portSegs    = rawSegments.filter(s => s.type === 'port' || s.type === 'latest-port')
  const totalFishDays    = fishSegs.reduce((n, s) => n + daysBetween(s.start, s.end), 0)
  const totalTransitDays = transitSegs.reduce((n, s) => n + s.days, 0)

  return (
    <div className="voyage-timeline">
      <div className="timeline-topbar">
        <span className="timeline-label">Voyage Timeline</span>
        <div className="timeline-summary">
          <span className="tl-stat tl-stat--fish">
            🎣 {fishSegs.length} trips · {Math.round(totalFishDays)}d fishing
          </span>
          <span className="tl-stat tl-stat--transit">
            ⟳ {transitSegs.length} transits · {Math.round(totalTransitDays)}d
          </span>
          {portSegs.length > 0 && (
            <span className="tl-stat tl-stat--port">⚓ {portSegs.length} ports</span>
          )}
          {encounters?.length > 0 && (
            <span className="tl-stat tl-stat--encounter">🤝 {encounters.length} encounters</span>
          )}
        </div>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-track">
          {segments.map((seg, i) => (
            <div key={i} className="tl-item">
              {i > 0 && <div className="tl-arrow">→</div>}
              <Segment seg={seg} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
