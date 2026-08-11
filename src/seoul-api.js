// 서울 열린데이터광장 Open API 호출 모듈
// - 재시도: HTTP 오류/타임아웃 시 최대 2회 재시도 (간격 5초) → 총 3회 시도
// - 로그에 API 키가 노출되지 않도록 URL 마스킹
// 전제조건: Node.js 20 이상 (전역 fetch 사용, 외부 의존성 없음)

import { CONFIG } from './config.js';

const HTTP_TIMEOUT_MS = 30 * 1000; // 응답 대기 최대 30초

/** API 호출 URL 생성. 시작/종료 인덱스는 1~5로 고정 (한 장소 조회에는 충분) */
export function buildUrl(service, areaCd) {
  const key = process.env.SEOUL_API_KEY;
  if (!key) throw new Error('환경변수 SEOUL_API_KEY가 설정되지 않았습니다.');
  return `${CONFIG.API_BASE}/${key}/json/${service}/1/5/${encodeURIComponent(areaCd)}`;
}

/** 로그 출력용: URL의 인증키 부분을 ***로 가린다 */
export function maskKey(url) {
  const key = process.env.SEOUL_API_KEY;
  if (!key) return url;
  return url.split(key).join('***');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 서울 API 1회 호출 (재시도 포함).
 * 반환: { status: 'success'|'http_error'|'parse_error', body, httpStatus, errorMsg, durationMs }
 * - 'success'는 "HTTP 200 + JSON 파싱 성공"까지만 의미한다.
 *   RESULT.CODE 검증(api_error 판정)은 호출한 쪽에서 수행한다.
 */
export async function fetchSeoul(service, areaCd) {
  const url = buildUrl(service, areaCd);
  const started = Date.now();
  let lastError = '';

  for (let attempt = 0; attempt <= CONFIG.MAX_RETRY; attempt++) {
    if (attempt > 0) await sleep(CONFIG.RETRY_DELAY_MS);

    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch (err) {
      // 네트워크 오류·타임아웃 → 재시도 대상
      lastError = `네트워크 오류: ${err.name}: ${err.message}`;
      console.warn(`[재시도 ${attempt + 1}/${CONFIG.MAX_RETRY + 1}] ${areaCd} ${maskKey(url)} — ${lastError}`);
      continue;
    }

    if (!res.ok) {
      // HTTP 4xx/5xx → 재시도 대상
      lastError = `HTTP ${res.status}`;
      console.warn(`[재시도 ${attempt + 1}/${CONFIG.MAX_RETRY + 1}] ${areaCd} — ${lastError}`);
      continue;
    }

    // JSON 파싱 실패는 재시도해도 같은 결과일 가능성이 높으므로 즉시 parse_error 처리
    let body;
    try {
      body = await res.json();
    } catch (err) {
      return {
        status: 'parse_error',
        body: null,
        httpStatus: res.status,
        errorMsg: `JSON 파싱 실패: ${err.message}`,
        durationMs: Date.now() - started,
      };
    }

    return {
      status: 'success',
      body,
      httpStatus: res.status,
      errorMsg: null,
      durationMs: Date.now() - started,
    };
  }

  return {
    status: 'http_error',
    body: null,
    httpStatus: null,
    errorMsg: `${CONFIG.MAX_RETRY + 1}회 시도 모두 실패: ${lastError}`,
    durationMs: Date.now() - started,
  };
}

/**
 * 응답에서 결과 코드를 꺼낸다. 서울 API는 응답 형태가 두 가지다.
 * - 성공 응답: RESULT["RESULT.CODE"]  (키에 점이 포함 — 대괄호 표기 필수)
 * - 오류 응답: RESULT.CODE
 * 어느 쪽도 없으면 null.
 */
export function extractResultCode(body) {
  if (!body || typeof body !== 'object') return null;
  const result = body.RESULT;
  if (!result || typeof result !== 'object') return null;
  return result['RESULT.CODE'] ?? result.CODE ?? null;
}

/** 결과 메시지 추출 (오류 로그용) */
export function extractResultMessage(body) {
  if (!body || typeof body !== 'object') return null;
  const result = body.RESULT;
  if (!result || typeof result !== 'object') return null;
  return result['RESULT.MESSAGE'] ?? result.MESSAGE ?? null;
}
