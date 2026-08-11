// 서울 실시간 도시데이터 수집기 — 진입점
//
// 실행 모드 (환경변수 COLLECT_MODE):
// - 'ppltn'    : 인구 API 121곳 수집 (10분 주기 cron이 사용)
// - 'citydata' : 통합 API raw 5곳 수집 (60분 주기 cron이 사용)
// - 'both'     : 둘 다 (수동 실행 기본값)
//
// 원칙:
// - 한 장소 실패로 전체를 중단하지 않는다 (기록 후 다음 장소로)
// - 전체 실행이 8분을 넘으면 남은 장소를 건너뛰고 기록 후 종료한다
// - 성공·실패 모두 collection_log에 기록한다

import { POI_LIST, RAW_TARGETS, CONFIG } from './config.js';
import { fetchSeoul, extractResultCode, extractResultMessage } from './seoul-api.js';
import { parseSnapshot, parseForecasts, shouldSaveForecast } from './parser.js';
import { insertSnapshot, insertForecasts, insertRaw, insertLog } from './db.js';

const runStarted = Date.now();

function elapsedMs() {
  return Date.now() - runStarted;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 8분 초과 시 남은 장소들을 collection_log에 'skipped'로 기록 */
async function logSkipped(apiType, remaining) {
  console.warn(`[시간 초과] 실행 ${Math.round(elapsedMs() / 1000)}초 경과 — ${remaining.length}곳 건너뜀`);
  for (const areaCd of remaining) {
    await insertLog({
      run_at: new Date().toISOString(),
      api_type: apiType,
      area_cd: areaCd,
      status: 'skipped',
      result_code: null,
      error_msg: '실행 시간 8분 초과로 이번 주기에서 건너뜀',
      duration_ms: null,
    });
  }
}

/** 인구 API 1곳 수집·저장 */
async function collectPpltnOne(areaCd) {
  const collectedAt = new Date().toISOString();
  const result = await fetchSeoul(CONFIG.SERVICE_PPLTN, areaCd);

  const logBase = {
    run_at: collectedAt,
    api_type: 'ppltn',
    area_cd: areaCd,
    duration_ms: result.durationMs,
  };

  if (result.status !== 'success') {
    await insertLog({ ...logBase, status: result.status, result_code: null, error_msg: result.errorMsg });
    console.warn(`[실패] ${areaCd} ppltn — ${result.status}: ${result.errorMsg}`);
    return false;
  }

  const code = extractResultCode(result.body);
  if (code !== 'INFO-000') {
    const msg = extractResultMessage(result.body) ?? '알 수 없는 오류';
    await insertLog({ ...logBase, status: 'api_error', result_code: code, error_msg: msg });
    console.warn(`[실패] ${areaCd} ppltn — api_error ${code}: ${msg}`);
    return false;
  }

  // citydata_ppltn은 1건이어도 배열이다
  const list = result.body['SeoulRtd.citydata_ppltn'];
  if (!Array.isArray(list) || list.length === 0) {
    await insertLog({
      ...logBase,
      status: 'parse_error',
      result_code: code,
      error_msg: 'SeoulRtd.citydata_ppltn이 비어 있음 — 저장 건너뜀',
    });
    console.warn(`[실패] ${areaCd} ppltn — 응답 데이터 없음`);
    return false;
  }

  const p = list[0];

  try {
    // 1) 스냅샷은 매번 저장 (중복 ppltn_time은 DB에서 조용히 무시됨)
    const snapshot = parseSnapshot(p, collectedAt);
    await insertSnapshot(snapshot);

    // 2) 예측은 ppltn_time의 분이 00~09일 때만, FCST_YN='Y'이고 배열이 있을 때만 저장
    let forecastNote = null;
    if (shouldSaveForecast(p.PPLTN_TIME)) {
      if (p.FCST_YN === 'Y' && Array.isArray(p.FCST_PPLTN) && p.FCST_PPLTN.length > 0) {
        const forecasts = parseForecasts(p);
        await insertForecasts(forecasts);
        if (forecasts.length !== 12) {
          forecastNote = `예측 ${forecasts.length}건 저장 (12건 아님 — 온 만큼 저장)`;
          console.warn(`[참고] ${areaCd} — ${forecastNote}`);
        }
      } else {
        forecastNote = `예측 없음 (FCST_YN=${p.FCST_YN ?? '없음'}) — 스냅샷만 저장`;
      }
    }

    await insertLog({ ...logBase, status: 'success', result_code: code, error_msg: forecastNote });
    return true;
  } catch (err) {
    // DB 저장 실패 — 기록 후 다음 장소로
    await insertLog({
      ...logBase,
      status: 'http_error',
      result_code: code,
      error_msg: `DB 저장 실패: ${err.message}`.slice(0, 500),
    });
    console.error(`[실패] ${areaCd} ppltn — DB 저장 실패: ${err.message}`);
    return false;
  }
}

/** 통합 API 1곳 수집·저장 (파싱 없이 응답 전문을 jsonb로 보관) */
async function collectCitydataOne(areaCd) {
  const collectedAt = new Date().toISOString();
  const result = await fetchSeoul(CONFIG.SERVICE_CITYDATA, areaCd);

  const logBase = {
    run_at: collectedAt,
    api_type: 'citydata',
    area_cd: areaCd,
    duration_ms: result.durationMs,
  };

  if (result.status !== 'success') {
    await insertLog({ ...logBase, status: result.status, result_code: null, error_msg: result.errorMsg });
    console.warn(`[실패] ${areaCd} citydata — ${result.status}: ${result.errorMsg}`);
    return false;
  }

  // 명시적 오류 코드가 확인되면 저장하지 않는다.
  // (서비스명이 틀리면 여기서 api_error가 기록된다 — 지시서 3-2 참조)
  const code = extractResultCode(result.body);
  if (code !== null && code !== 'INFO-000') {
    const msg = extractResultMessage(result.body) ?? '알 수 없는 오류';
    await insertLog({ ...logBase, status: 'api_error', result_code: code, error_msg: msg });
    console.warn(`[실패] ${areaCd} citydata — api_error ${code}: ${msg} (서비스명 확인 필요할 수 있음)`);
    return false;
  }

  try {
    // 원본 JSON을 통째로 저장 — 정규화하지 않는다 (의도된 설계, 지시서 5-3)
    await insertRaw(areaCd, collectedAt, result.body);
    await insertLog({ ...logBase, status: 'success', result_code: code ?? 'INFO-000', error_msg: null });
    return true;
  } catch (err) {
    await insertLog({
      ...logBase,
      status: 'http_error',
      result_code: code,
      error_msg: `DB 저장 실패: ${err.message}`.slice(0, 500),
    });
    console.error(`[실패] ${areaCd} citydata — DB 저장 실패: ${err.message}`);
    return false;
  }
}

/** 장소 목록을 순차 수집. 호출 간 200ms 지연, 8분 초과 시 잔여 건너뜀 */
async function runCollection(apiType, areaCds, collectOne) {
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < areaCds.length; i++) {
    if (elapsedMs() > CONFIG.RUN_TIMEOUT_MS) {
      await logSkipped(apiType, areaCds.slice(i));
      break;
    }
    const success = await collectOne(areaCds[i]);
    if (success) ok++;
    else fail++;
    if (i < areaCds.length - 1) await sleep(CONFIG.REQUEST_DELAY_MS);
  }
  console.log(`[완료] ${apiType}: 성공 ${ok} / 실패 ${fail} / 대상 ${areaCds.length}`);
  return { ok, fail };
}

async function main() {
  const mode = process.env.COLLECT_MODE || 'both';
  console.log(`수집 시작 — 모드: ${mode}, 시각: ${new Date().toISOString()}`);

  if (mode === 'ppltn' || mode === 'both') {
    await runCollection('ppltn', POI_LIST.map((p) => p.cd), collectPpltnOne);
  }

  if (mode === 'citydata' || mode === 'both') {
    await runCollection('citydata', RAW_TARGETS, collectCitydataOne);
  }

  console.log(`수집 종료 — 총 소요 ${Math.round(elapsedMs() / 1000)}초`);
}

main().catch((err) => {
  // 최상위 오류(환경변수 누락 등)만 여기 도달한다. 원인을 명확히 남기고 실패 종료.
  console.error(`[치명적 오류] ${err.message}`);
  process.exit(1);
});
