// API 응답(전부 문자열) → DB 저장 형태 변환
// 핵심 규칙:
// - 인구수는 반드시 integer로 변환 (문자열 저장 금지 — "9000" > "24000" 문제)
// - 비율은 numeric으로 변환
// - 시각은 KST(Asia/Seoul, +09:00) 기준 timestamptz 문자열로 변환

/** "24000" → 24000. 변환 불가하면 null (오류로 중단하지 않는다) */
export function toInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

/** "54.8" → 54.8. 변환 불가하면 null */
export function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(String(value));
  return Number.isNaN(n) ? null : n;
}

/**
 * API의 시각 문자열("2026-08-11 08:25")을 KST 명시 ISO 형식으로 변환.
 * 서울시 API는 시간대 표기 없이 KST 값을 주므로 +09:00을 붙여 저장한다.
 * 형식이 다르면 null 반환.
 */
export function kstToIso(value) {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const sec = m[6] ?? '00';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${sec}+09:00`;
}

/** 시각 문자열에서 분(minute)만 추출. 예측 저장 여부 판정용. 실패 시 null */
export function extractMinute(value) {
  if (!value) return null;
  const m = String(value).trim().match(/(\d{2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[2], 10);
}

/**
 * 인구 API 응답 1건(citydata_ppltn 배열의 [0]) → ppltn_snapshot 행.
 * collectedAt: 실제 수집 시각 (ISO 문자열)
 */
export function parseSnapshot(p, collectedAt) {
  return {
    area_cd: p.AREA_CD ?? null,
    area_nm: p.AREA_NM ?? null,
    ppltn_time: kstToIso(p.PPLTN_TIME),
    collected_at: collectedAt,
    congest_lvl: p.AREA_CONGEST_LVL ?? null,
    congest_msg: p.AREA_CONGEST_MSG ?? null,
    ppltn_min: toInt(p.AREA_PPLTN_MIN),
    ppltn_max: toInt(p.AREA_PPLTN_MAX),
    male_rate: toNum(p.MALE_PPLTN_RATE),
    female_rate: toNum(p.FEMALE_PPLTN_RATE),
    rate_0: toNum(p.PPLTN_RATE_0),
    rate_10: toNum(p.PPLTN_RATE_10),
    rate_20: toNum(p.PPLTN_RATE_20),
    rate_30: toNum(p.PPLTN_RATE_30),
    rate_40: toNum(p.PPLTN_RATE_40),
    rate_50: toNum(p.PPLTN_RATE_50),
    rate_60: toNum(p.PPLTN_RATE_60),
    rate_70: toNum(p.PPLTN_RATE_70),
    resnt_rate: toNum(p.RESNT_PPLTN_RATE),
    non_resnt_rate: toNum(p.NON_RESNT_PPLTN_RATE),
    replace_yn: p.REPLACE_YN ?? null,
    fcst_yn: p.FCST_YN ?? null,
  };
}

/**
 * 예측 12건 → ppltn_forecast 행 배열.
 * base_time(예측 수행 시점)은 원본 FCST_PPLTN에 없으므로
 * 스냅샷의 PPLTN_TIME을 복사해 넣는다. base_time과 fcst_time 둘 다 필수.
 *
 * 저장 조건 판정(분 00~09, FCST_YN 등)은 호출한 쪽(index.js)에서 수행하고,
 * 이 함수는 변환만 담당한다.
 */
export function parseForecasts(p) {
  const baseTime = kstToIso(p.PPLTN_TIME);
  const fcstList = Array.isArray(p.FCST_PPLTN) ? p.FCST_PPLTN : [];
  return fcstList
    .map((f) => ({
      area_cd: p.AREA_CD ?? null,
      base_time: baseTime,
      fcst_time: kstToIso(f.FCST_TIME),
      fcst_congest_lvl: f.FCST_CONGEST_LVL ?? null,
      fcst_ppltn_min: toInt(f.FCST_PPLTN_MIN),
      fcst_ppltn_max: toInt(f.FCST_PPLTN_MAX),
    }))
    // base_time/fcst_time이 없는 행은 UNIQUE 제약을 만족할 수 없으므로 제외
    .filter((row) => row.base_time !== null && row.fcst_time !== null);
}

/**
 * 예측 저장 여부 판정.
 *
 * [2026-09-03 변경] 원래는 ppltn_time의 분이 00~09일 때만 저장했다(용량 절약 목적,
 * 10분 간격 실행이 전제). GitHub 스케줄 지연으로 실행 시각이 불규칙해지면서 이 조건이
 * 예측 확보를 하루 1~2건으로 붕괴시켜, 사용자 승인 하에 매 실행 저장으로 완화했다.
 * 중복은 DB의 UNIQUE(area_cd, base_time, fcst_time) + ON CONFLICT DO NOTHING이 걸러낸다.
 * base_time이 정시에 정렬되지 않으므로(예 09:35) 분석 시 시각 반올림이 필요하다.
 * 상세 경위: DEVIATIONS.md 참조.
 */
export function shouldSaveForecast(ppltnTimeRaw) {
  return kstToIso(ppltnTimeRaw) !== null; // 시각이 유효하면 항상 저장
}
