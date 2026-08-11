// Supabase 저장 모듈 — PostgREST REST API 직접 호출
//
// 왜 공식 supabase-js 라이브러리를 쓰지 않았나:
//   외부 의존성이 0개면 GitHub Actions에서 npm install 단계가 필요 없어
//   실행이 빠르고, 공급망(의존성) 리스크도 없다. 이 프로젝트는 INSERT만 하므로
//   REST 호출로 충분하다. (DEVIATIONS.md 참조)
//
// 전제조건:
// - 환경변수 SUPABASE_URL (예: https://xxxx.supabase.co)
// - 환경변수 SUPABASE_SERVICE_KEY (service_role 키 — GitHub Secrets에만 보관)
// - service_role 키는 RLS를 우회하므로 서버(Actions) 전용. 절대 클라이언트 노출 금지.

const DB_TIMEOUT_MS = 30 * 1000;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name}이(가) 설정되지 않았습니다.`);
  return v;
}

/**
 * rows(객체 배열)를 지정 테이블에 INSERT.
 * options.onConflict: 'area_cd,ppltn_time' 형태 — 지정 시 중복 행은 조용히 건너뜀
 *                     (PostgREST의 resolution=ignore-duplicates = ON CONFLICT DO NOTHING)
 * 실패 시 예외를 던진다. 호출한 쪽에서 try/catch로 처리할 것.
 */
export async function insertRows(table, rows, options = {}) {
  if (!rows || rows.length === 0) return;

  const baseUrl = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY');

  let url = `${baseUrl}/rest/v1/${table}`;
  const prefer = ['return=minimal'];
  if (options.onConflict) {
    url += `?on_conflict=${encodeURIComponent(options.onConflict)}`;
    prefer.push('resolution=ignore-duplicates');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: prefer.join(','),
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 500);
    throw new Error(`Supabase 저장 실패 (${table}, HTTP ${res.status}): ${text}`);
  }
}

/** ppltn_snapshot 1행 저장. 중복(area_cd, ppltn_time)은 조용히 건너뜀 */
export async function insertSnapshot(row) {
  await insertRows('ppltn_snapshot', [row], { onConflict: 'area_cd,ppltn_time' });
}

/** ppltn_forecast 여러 행 저장. 중복(area_cd, base_time, fcst_time)은 조용히 건너뜀 */
export async function insertForecasts(rows) {
  await insertRows('ppltn_forecast', rows, { onConflict: 'area_cd,base_time,fcst_time' });
}

/** citydata_raw 1행 저장 (payload는 응답 전문 jsonb) */
export async function insertRaw(areaCd, collectedAt, payload) {
  await insertRows('citydata_raw', [{ area_cd: areaCd, collected_at: collectedAt, payload }]);
}

/**
 * collection_log 1행 저장. 성공·실패 모두 기록한다.
 * 로그 저장 자체가 실패해도 수집을 멈추지 않도록 예외를 삼키고 콘솔에만 남긴다.
 */
export async function insertLog(entry) {
  try {
    await insertRows('collection_log', [entry]);
  } catch (err) {
    console.error(`[경고] collection_log 저장 실패 (수집은 계속): ${err.message}`);
  }
}
