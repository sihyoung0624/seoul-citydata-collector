// 백업 + 정리 스크립트
//
// 사용법:
//   node src/backup.js export   — 완료된 날짜(KST 기준 어제까지)를 하루 1파일로 내보냄
//                                 (backup/<테이블>/<YYYY-MM-DD>.ndjson.gz, 이미 있으면 건너뜀)
//   node src/backup.js cleanup  — 보존기간(30일) 지난 citydata_raw·collection_log 행 삭제.
//                                 단, 해당 기간 전체의 백업 파일이 존재할 때만 삭제한다.
//
// 안전 원칙 (워크플로에서 강제됨):
//   export → git 커밋·푸시 성공 → cleanup 순서로만 실행된다.
//   푸시가 실패하면 cleanup은 실행되지 않으므로 백업 없는 삭제는 일어나지 않는다.
//
// 핵심 데이터(ppltn_snapshot, ppltn_forecast)는 백업만 하고 삭제하지 않는다.

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const TABLES = [
  { name: 'ppltn_snapshot', timeCol: 'collected_at' },
  { name: 'ppltn_forecast', timeCol: 'base_time' },
  { name: 'citydata_raw',   timeCol: 'collected_at' },
  { name: 'collection_log', timeCol: 'run_at' },
];

// 보존기간(일). 여기 없는 테이블은 삭제하지 않는다.
const RETENTION_DAYS = {
  citydata_raw: 30,
  collection_log: 30,
};

const PAGE_SIZE = 1000;
const BACKUP_DIR = path.join(process.cwd(), 'backup');
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name}이(가) 설정되지 않았습니다.`);
  return v;
}

const BASE_URL = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
const SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

/** timestamptz 문자열/Date → KST 날짜 문자열 'YYYY-MM-DD' */
function toKstDay(ts) {
  return new Date(new Date(ts).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** KST 날짜 문자열 → [그날 00:00 KST, 다음날 00:00 KST) ISO 경계 */
function dayRange(day) {
  const start = `${day}T00:00:00+09:00`;
  const nextUtc = new Date(new Date(`${day}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000);
  const end = `${nextUtc.toISOString().slice(0, 10)}T00:00:00+09:00`;
  return { start, end };
}

/** 다음 날짜 문자열 */
function nextDay(day) {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`조회 실패 (HTTP ${res.status}): ${text}`);
  }
  return res.json();
}

/** 테이블에서 가장 오래된 행의 시각을 KST 날짜로 반환. 비어 있으면 null */
async function getMinDay(table, timeCol) {
  const rows = await fetchJson(
    `${BASE_URL}/rest/v1/${table}?select=${timeCol}&order=${timeCol}.asc&limit=1`
  );
  if (!rows.length) return null;
  return toKstDay(rows[0][timeCol]);
}

/** 특정 KST 하루치 행 전체를 페이지 단위로 가져온다 */
async function fetchDayRows(table, timeCol, day) {
  const { start, end } = dayRange(day);
  const all = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url =
      `${BASE_URL}/rest/v1/${table}` +
      `?${timeCol}=gte.${encodeURIComponent(start)}` +
      `&${timeCol}=lt.${encodeURIComponent(end)}` +
      `&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
    const page = await fetchJson(url);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

function backupFilePath(table, day) {
  return path.join(BACKUP_DIR, table, `${day}.ndjson.gz`);
}

/** export 모드: 어제(KST)까지의 모든 날짜를 파일로. 이미 있는 파일은 건너뜀 */
async function runExport() {
  const todayKst = toKstDay(new Date());
  let written = 0;

  for (const { name, timeCol } of TABLES) {
    const minDay = await getMinDay(name, timeCol);
    if (!minDay) {
      console.log(`[${name}] 데이터 없음 — 건너뜀`);
      continue;
    }
    mkdirSync(path.join(BACKUP_DIR, name), { recursive: true });

    for (let day = minDay; day < todayKst; day = nextDay(day)) {
      const file = backupFilePath(name, day);
      if (existsSync(file)) continue;

      const rows = await fetchDayRows(name, timeCol, day);
      // 0행이어도 빈 파일을 만들어 "이 날짜는 처리 완료"를 표시한다
      const ndjson = rows.map((r) => JSON.stringify(r)).join('\n');
      writeFileSync(file, gzipSync(Buffer.from(ndjson, 'utf8')));
      written++;
      console.log(`[${name}] ${day} — ${rows.length}행 백업`);
    }
  }
  console.log(`백업 완료: 새 파일 ${written}개`);
}

/** cleanup 모드: 보존기간 지난 행 삭제. 백업 파일이 전부 존재할 때만 */
async function runCleanup() {
  const todayKst = toKstDay(new Date());

  for (const { name, timeCol } of TABLES) {
    const retention = RETENTION_DAYS[name];
    if (!retention) continue; // 핵심 테이블은 삭제하지 않음

    const minDay = await getMinDay(name, timeCol);
    if (!minDay) continue;

    // 삭제 상한: 오늘 - 보존기간 (그날 00:00 KST 이전 행을 삭제)
    const cutoffDay = toKstDay(new Date(Date.now() - retention * 24 * 60 * 60 * 1000));
    if (minDay >= cutoffDay) {
      console.log(`[${name}] ${retention}일 지난 데이터 없음 — 삭제 건너뜀`);
      continue;
    }

    // 안전 확인: 삭제 대상 기간(minDay ~ cutoffDay 전날)의 백업 파일이 전부 있는가
    let missing = null;
    for (let day = minDay; day < cutoffDay; day = nextDay(day)) {
      if (!existsSync(backupFilePath(name, day))) { missing = day; break; }
    }
    if (missing) {
      console.warn(`[경고] [${name}] ${missing} 백업 파일이 없어 삭제를 건너뜁니다. 다음 실행에서 재시도됩니다.`);
      continue;
    }

    const { start: cutoffIso } = dayRange(cutoffDay);
    const res = await fetch(
      `${BASE_URL}/rest/v1/${name}?${timeCol}=lt.${encodeURIComponent(cutoffIso)}`,
      { method: 'DELETE', headers: { ...HEADERS, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(120_000) }
    );
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`[${name}] 삭제 실패 (HTTP ${res.status}): ${text}`);
    }
    console.log(`[${name}] ${cutoffDay} 이전(KST) 행 삭제 완료 (백업 확인됨)`);
  }
  console.log('정리 완료');
}

const mode = process.argv[2];
const run = mode === 'export' ? runExport : mode === 'cleanup' ? runCleanup : null;
if (!run) {
  console.error('사용법: node src/backup.js export | cleanup');
  process.exit(1);
}
run().catch((err) => {
  console.error(`[치명적 오류] ${err.message}`);
  process.exit(1);
});
