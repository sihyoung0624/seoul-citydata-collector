-- 서울 실시간 도시데이터 수집기 — 초기 스키마
-- 실행 위치: Supabase 대시보드 > SQL Editor
-- 테이블 4개 + 인덱스 + RLS(행 수준 보안)
--
-- 주의: 이 스크립트는 여러 번 실행해도 안전하도록 IF NOT EXISTS를 사용한다.

-- ============================================================
-- 1. ppltn_snapshot — 실측 인구 (수집 1회당 장소별 1행)
-- ============================================================
create table if not exists public.ppltn_snapshot (
  id             bigserial primary key,
  area_cd        text not null,                -- 예: POI009
  area_nm        text,                         -- 예: 광화문·덕수궁
  ppltn_time     timestamptz not null,         -- API가 준 기준시각 (KST)
  collected_at   timestamptz not null,         -- 실제 수집 시각
  congest_lvl    text,                         -- 여유/보통/약간 붐빔/붐빔
  congest_msg    text,
  ppltn_min      integer,                      -- 숫자로 변환 저장 (문자열 금지)
  ppltn_max      integer,                      -- 숫자로 변환 저장 (문자열 금지)
  male_rate      numeric(4,1),
  female_rate    numeric(4,1),
  rate_0         numeric(4,1),
  rate_10        numeric(4,1),
  rate_20        numeric(4,1),
  rate_30        numeric(4,1),
  rate_40        numeric(4,1),
  rate_50        numeric(4,1),
  rate_60        numeric(4,1),
  rate_70        numeric(4,1),
  resnt_rate     numeric(4,1),                 -- 상주 비율
  non_resnt_rate numeric(4,1),                 -- 비상주 비율
  replace_yn     char(1),                      -- 대체값 여부
  fcst_yn        char(1),
  -- API가 15분 지연 데이터를 주므로 동일 ppltn_time이 중복 수신될 수 있다.
  -- 중복은 수집기에서 ON CONFLICT DO NOTHING으로 조용히 건너뛴다.
  constraint uq_snapshot unique (area_cd, ppltn_time)
);

-- 시계열 조회용 (area_cd 단독 조회는 uq_snapshot 인덱스가 커버)
create index if not exists idx_snapshot_ppltn_time on public.ppltn_snapshot (ppltn_time);

-- ============================================================
-- 2. ppltn_forecast — 12시간 예측 (정시 구간 수집 1회당 12행)
-- ============================================================
create table if not exists public.ppltn_forecast (
  id               bigserial primary key,
  area_cd          text not null,
  base_time        timestamptz not null,       -- 예측을 수행한 시점 = 스냅샷의 ppltn_time
  fcst_time        timestamptz not null,       -- 예측 대상 시각
  fcst_congest_lvl text,
  fcst_ppltn_min   integer,
  fcst_ppltn_max   integer,
  -- base_time과 fcst_time이 둘 다 있어야
  -- "N시간 전 예측이 실제로 맞았는가"를 계산할 수 있다 (이 수집기의 핵심 가치)
  constraint uq_forecast unique (area_cd, base_time, fcst_time)
);

-- 예측-실측 대조 조회용 (fcst_time으로 스냅샷과 조인)
create index if not exists idx_forecast_fcst_time on public.ppltn_forecast (area_cd, fcst_time);

-- ============================================================
-- 3. citydata_raw — 통합 API 원본 보관 (파싱하지 않음, 의도된 설계)
-- ============================================================
create table if not exists public.citydata_raw (
  id           bigserial primary key,
  area_cd      text not null,
  collected_at timestamptz not null,
  payload      jsonb not null                  -- 응답 전문. 정규화 금지 (지시서 5-3)
);

create index if not exists idx_raw_area_time on public.citydata_raw (area_cd, collected_at);

-- ============================================================
-- 4. collection_log — 실행 기록 (성공·실패 모두 기록)
-- ============================================================
create table if not exists public.collection_log (
  id          bigserial primary key,
  run_at      timestamptz not null,
  api_type    text,                            -- ppltn / citydata
  area_cd     text,
  status      text,                            -- success / api_error / http_error / parse_error / skipped
  result_code text,                            -- INFO-000 등
  error_msg   text,                            -- 오류 메시지만 (응답 전문 저장 금지)
  duration_ms integer
);

create index if not exists idx_log_run_at on public.collection_log (run_at);
create index if not exists idx_log_status on public.collection_log (status, run_at);

-- ============================================================
-- 5. RLS(행 수준 보안) — 익명(anon) 접근 차단
-- ============================================================
-- RLS를 켜고 정책(policy)을 하나도 만들지 않으면 anon/authenticated는
-- 아무 행도 읽거나 쓸 수 없다. 수집기는 service_role 키를 사용하며
-- service_role은 RLS를 우회하므로 정상 동작한다. (이 데이터는 현재 서버 전용)
alter table public.ppltn_snapshot enable row level security;
alter table public.ppltn_forecast enable row level security;
alter table public.citydata_raw   enable row level security;
alter table public.collection_log enable row level security;

-- 방어층 추가: anon/authenticated 역할의 테이블 권한 자체를 회수
revoke all on public.ppltn_snapshot, public.ppltn_forecast, public.citydata_raw, public.collection_log
  from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
