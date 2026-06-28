-- Codwatch — PostgreSQL schema
-- Vessel monitoring for Dissostichus eleginoides (Patagonian toothfish)
-- Source data: CCAMLR authorized vessel list + Global Fishing Watch API v3
--
-- CCAMLR season: Dec 1 → Nov 30 (e.g. "2025 season" = 2025-12-01 to 2026-11-30)
-- GFW data lag:  96 hours (events are available ~4 days after they occur)
-- GFW query max: 366 days per request; use 365-day chunks in backfill
--
-- Tables:
--   vessels               — one row per CCAMLR-authorized vessel (32 total, 27 with GFW IDs)
--   vessel_authorizations — CCAMLR authorization periods per vessel (many-to-one)
--   fishing_events        — GFW fishing activity detections
--   port_visits           — GFW port visit detections (where catch is landed)
--   encounters            — GFW vessel-to-vessel encounters (potential transhipment)
--   ais_gaps              — AIS signal loss events (dark vessel behavior)
--   backfill_log          — tracks what has been fetched so backfill can resume safely

-- ============================================================
-- CORE VESSEL TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS vessels (
    id                      SERIAL PRIMARY KEY,
    vessel_name             TEXT NOT NULL UNIQUE,
    flag                    TEXT NOT NULL,          -- CCAMLR flag country (full name)
    ccamlr_member           TEXT NOT NULL,          -- differs from flag only for Globalpesca III
    gfw_vessel_id           TEXT UNIQUE,            -- NULL for 5 unmatched vessels
    gfw_ssvid               TEXT,                   -- MMSI (AIS transponder ID)
    gfw_imo                 TEXT,                   -- IMO number
    gfw_callsign            TEXT,
    gfw_flag                TEXT,                   -- ISO3 flag code from GFW
    gfw_geartypes           TEXT[],                 -- e.g. {"SET_LONGLINES"}
    gfw_ais_from            TIMESTAMPTZ,
    gfw_ais_to              TIMESTAMPTZ,
    gfw_match_confidence    TEXT,                   -- exact | name_and_flag | name_only | multiple_candidates | not_found
    eleginoides_authorized  BOOLEAN NOT NULL DEFAULT FALSE,
    mawsoni_authorized      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN vessels.gfw_match_confidence IS
    'exact=name+flag matched; name_and_flag=multiple records same vessel; '
    'name_only=flag mismatch; multiple_candidates=ambiguous; not_found=no GFW record';

CREATE TABLE IF NOT EXISTS vessel_authorizations (
    id              SERIAL PRIMARY KEY,
    vessel_id       INTEGER NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
    period_from     DATE NOT NULL,
    period_to       DATE NOT NULL,
    areas           TEXT[] NOT NULL,   -- CCAMLR subareas e.g. {"48.3","48.4"}
    target_species  TEXT[] NOT NULL    -- {"Dissostichus eleginoides","Dissostichus mawsoni"}
);

CREATE INDEX IF NOT EXISTS idx_vessel_auth_vessel ON vessel_authorizations(vessel_id);
CREATE INDEX IF NOT EXISTS idx_vessel_auth_period ON vessel_authorizations(period_from, period_to);

-- ============================================================
-- GFW EVENT TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS fishing_events (
    event_id        TEXT PRIMARY KEY,
    vessel_id       INTEGER NOT NULL REFERENCES vessels(id),
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ,
    duration_hours  DOUBLE PRECISION,
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    fao_areas       TEXT[],            -- e.g. {"48","48.3"} — major and subarea
    rfmo_areas      TEXT[],            -- e.g. {"CCAMLR"}
    eez_areas       TEXT[],
    high_seas       TEXT[],
    auth_status     TEXT,              -- publicly_authorized | not_matching_relevant_public_authorization
    raw             JSONB NOT NULL,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fishing_vessel_time ON fishing_events(vessel_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_fishing_start      ON fishing_events(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_fishing_fao        ON fishing_events USING GIN(fao_areas);
CREATE INDEX IF NOT EXISTS idx_fishing_rfmo       ON fishing_events USING GIN(rfmo_areas);

-- Query: "fishing events in CCAMLR subarea 48.3 this season"
-- SELECT fe.*, v.vessel_name FROM fishing_events fe JOIN vessels v ON v.id = fe.vessel_id
-- WHERE '48.3' = ANY(fe.fao_areas) AND 'CCAMLR' = ANY(fe.rfmo_areas)
--   AND fe.start_time >= '2025-12-01' AND fe.start_time < '2026-12-01';

CREATE TABLE IF NOT EXISTS port_visits (
    event_id        TEXT PRIMARY KEY,
    vessel_id       INTEGER NOT NULL REFERENCES vessels(id),
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ,
    duration_hours  DOUBLE PRECISION,
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    port_name       TEXT,
    port_id         TEXT,              -- GFW anchorage ID
    port_flag       TEXT,              -- ISO3 country of port
    confidence      INTEGER,           -- GFW confidence 1-4 (4 = highest)
    raw             JSONB NOT NULL,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_port_vessel_time ON port_visits(vessel_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_port_start       ON port_visits(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_port_flag        ON port_visits(port_flag);

-- Query: "which vessels made port visits in the last 30 days"
-- SELECT v.vessel_name, pv.port_name, pv.port_flag, pv.start_time, pv.duration_hours
-- FROM port_visits pv JOIN vessels v ON v.id = pv.vessel_id
-- WHERE pv.start_time >= NOW() - INTERVAL '30 days'
-- ORDER BY pv.start_time DESC;

-- Query: "which vessels have landed at which regions on what date"
-- SELECT v.vessel_name, pv.port_name, pv.port_flag, pv.start_time::date
-- FROM port_visits pv JOIN vessels v ON v.id = pv.vessel_id
-- ORDER BY pv.start_time DESC;

CREATE TABLE IF NOT EXISTS encounters (
    event_id                TEXT PRIMARY KEY,
    vessel_id               INTEGER NOT NULL REFERENCES vessels(id),
    start_time              TIMESTAMPTZ NOT NULL,
    end_time                TIMESTAMPTZ,
    duration_hours          DOUBLE PRECISION,
    lat                     DOUBLE PRECISION,
    lon                     DOUBLE PRECISION,
    fao_areas               TEXT[],
    rfmo_areas              TEXT[],
    encountered_vessel_id   TEXT,       -- GFW vessel ID of the other vessel
    encountered_vessel_name TEXT,
    encountered_vessel_flag TEXT,       -- ISO3
    encounter_type          TEXT,       -- CARRIER_FISHING | FISHING_SUPPORT | etc.
    median_distance_km      DOUBLE PRECISION,
    median_speed_knots      DOUBLE PRECISION,
    raw                     JSONB NOT NULL,
    ingested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_encounter_vessel_time ON encounters(vessel_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_encounter_start       ON encounters(start_time DESC);

CREATE TABLE IF NOT EXISTS ais_gaps (
    event_id            TEXT PRIMARY KEY,
    vessel_id           INTEGER NOT NULL REFERENCES vessels(id),
    start_time          TIMESTAMPTZ NOT NULL,   -- when AIS signal was lost
    end_time            TIMESTAMPTZ,            -- when signal resumed (NULL if ongoing)
    gap_hours           DOUBLE PRECISION,
    lat_off             DOUBLE PRECISION,       -- position when AIS switched off
    lon_off             DOUBLE PRECISION,
    lat_on              DOUBLE PRECISION,       -- position when AIS resumed
    lon_on              DOUBLE PRECISION,
    distance_km         DOUBLE PRECISION,       -- distance vessel traveled while dark
    implied_speed_knots DOUBLE PRECISION,
    fao_areas           TEXT[],
    rfmo_areas          TEXT[],
    raw                 JSONB NOT NULL,
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gap_vessel_time ON ais_gaps(vessel_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_gap_hours       ON ais_gaps(gap_hours DESC);

-- Query: "which vessels have AIS gaps longer than 7 days"
-- SELECT v.vessel_name, ag.start_time, ag.end_time, ag.gap_hours, ag.distance_km
-- FROM ais_gaps ag JOIN vessels v ON v.id = ag.vessel_id
-- WHERE ag.gap_hours > 168   -- 7 days * 24
-- ORDER BY ag.gap_hours DESC;

-- ============================================================
-- BACKFILL TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS backfill_log (
    id              SERIAL PRIMARY KEY,
    vessel_id       INTEGER REFERENCES vessels(id),
    event_type      TEXT NOT NULL,      -- fishing | port_visit | encounter | ais_gap
    period_from     DATE NOT NULL,
    period_to       DATE NOT NULL,
    events_fetched  INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'success',  -- success | error
    error_msg       TEXT,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backfill_lookup ON backfill_log(vessel_id, event_type, period_from);
