-- "서울 어디가?" 사이트용 집계 함수 3개
-- 실행 위치: Supabase SQL Editor (또는 MCP apply_migration)
-- 호출 주체: GitHub Actions의 site-build.js (service_role 키) 전용.
--            anon/authenticated의 실행 권한은 아래에서 회수한다 (외부 직접 호출 차단).

-- 1. 현재 상황: 장소별 최신 실측 + 최신 예측 12시간
create or replace function public.site_current()
returns jsonb language sql stable as $$
  with latest as (
    select distinct on (area_cd) area_cd, area_nm, congest_lvl, ppltn_min, ppltn_max,
           ppltn_time, collected_at
    from ppltn_snapshot
    where collected_at > now() - interval '6 hours'
    order by area_cd, collected_at desc
  ),
  latest_fcst as (
    select distinct on (f.area_cd, f.fcst_time)
           f.area_cd, f.fcst_time, f.fcst_congest_lvl, f.fcst_ppltn_min, f.fcst_ppltn_max
    from ppltn_forecast f
    where f.base_time > now() - interval '6 hours' and f.fcst_time > now()
    order by f.area_cd, f.fcst_time, f.base_time desc
  )
  select jsonb_build_object(
    'generated_at', now(),
    'areas', coalesce((select jsonb_object_agg(area_cd, jsonb_build_object(
        'nm', area_nm, 'lvl', congest_lvl, 'min', ppltn_min, 'max', ppltn_max,
        'ppltn_time', ppltn_time, 'collected_at', collected_at)) from latest), '{}'::jsonb),
    'forecasts', coalesce((select jsonb_object_agg(area_cd, fl) from (
        select area_cd, jsonb_agg(jsonb_build_object(
          't', fcst_time, 'lvl', fcst_congest_lvl, 'min', fcst_ppltn_min, 'max', fcst_ppltn_max)
          order by fcst_time) as fl
        from latest_fcst group by area_cd) x), '{}'::jsonb)
  );
$$;

-- 2. 평소 패턴: 장소 × 요일(1=월...7=일) × 시(KST) 평균 (DB 보존분 = 최근 90일)
create or replace function public.site_patterns()
returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(area_cd, by_slot), '{}'::jsonb) from (
    select area_cd, jsonb_object_agg(slot, vals) as by_slot from (
      select area_cd,
             (extract(isodow from ppltn_time at time zone 'Asia/Seoul')::int)::text || '-' ||
             (extract(hour  from ppltn_time at time zone 'Asia/Seoul')::int)::text as slot,
             jsonb_build_object(
               'n',   count(*),
               'mid', round(avg((ppltn_min + ppltn_max) / 2.0)),
               'lvl', mode() within group (order by congest_lvl)) as vals
      from ppltn_snapshot
      group by 1, 2
    ) s group by area_cd
  ) a;
$$;

-- 3. 장소별 예측 신뢰도: 예측-실측(±20분 매칭) 단계 적중률·인구 오차
create or replace function public.site_reliability()
returns jsonb language sql stable as $$
  with matched as (
    select f.area_cd,
           (case f.fcst_congest_lvl when '여유' then 1 when '보통' then 2 when '약간 붐빔' then 3 when '붐빔' then 4 end
            = case s.congest_lvl    when '여유' then 1 when '보통' then 2 when '약간 붐빔' then 3 when '붐빔' then 4 end)::int as hit,
           abs((f.fcst_ppltn_min + f.fcst_ppltn_max)/2.0 - (s.ppltn_min + s.ppltn_max)/2.0)
             / nullif((s.ppltn_min + s.ppltn_max)/2.0, 0) as err
    from ppltn_forecast f
    join lateral (
      select congest_lvl, ppltn_min, ppltn_max from ppltn_snapshot s
      where s.area_cd = f.area_cd
        and s.ppltn_time between f.fcst_time - interval '20 minutes' and f.fcst_time + interval '20 minutes'
      order by abs(extract(epoch from (s.ppltn_time - f.fcst_time))) limit 1) s on true
    where f.fcst_ppltn_min is not null
  )
  select jsonb_build_object(
    'generated_at', now(),
    'overall', (select jsonb_build_object(
        'exact', round(100.0*avg(hit), 1), 'mape', round(100.0*avg(err)*100, 1), 'pairs', count(*)) from matched),
    'areas', coalesce((select jsonb_object_agg(area_cd, jsonb_build_object('exact', e, 'mape', m, 'n', n)) from (
        select area_cd, round(100.0*avg(hit), 1) as e, round(100.0*avg(err)*100, 1) as m, count(*) as n
        from matched group by area_cd having count(*) >= 100) x), '{}'::jsonb)
  );
$$;

-- 외부(anon/authenticated) 직접 호출 차단 — service_role 전용
revoke execute on function public.site_current()     from anon, authenticated, public;
revoke execute on function public.site_patterns()    from anon, authenticated, public;
revoke execute on function public.site_reliability() from anon, authenticated, public;
