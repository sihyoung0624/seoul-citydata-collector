// "서울 어디가?" 사이트 데이터 빌더
//
// 사용법:
//   node src/site-build.js full     — current + patterns + reliability 전부 재생성 (주 1회)
//   node src/site-build.js current  — current만 재생성, 나머지는 운영 중인 사이트에서 재사용 (매시)
//
// DB 호출은 sql/002_site_functions.sql 의 집계 함수(RPC) 3개뿐이다.
// 출력: site/data/*.json  (site/ 폴더 전체가 GitHub Pages로 배포됨)

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { POI_LIST } from './config.js';

const mode = process.argv[2] || 'full';
// 운영 중인 사이트 주소 — current 모드에서 patterns/reliability 재사용에 사용
const LIVE_SITE = process.env.SITE_URL || 'https://sihyoung0624.github.io/seoul-citydata-collector';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name}이(가) 설정되지 않았습니다.`);
  return v;
}

const BASE = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
const KEY = requireEnv('SUPABASE_SERVICE_KEY');

async function rpc(name) {
  const res = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`RPC ${name} 실패 (HTTP ${res.status}): ${text}`);
  }
  return res.json();
}

/** 운영 중 사이트에서 기존 파일 재사용 (실패하면 null → full 재생성으로 폴백) */
async function fromLiveSite(file) {
  try {
    const res = await fetch(`${LIVE_SITE}/data/${file}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const outDir = path.join(process.cwd(), 'site', 'data');
mkdirSync(outDir, { recursive: true });
const save = (file, data) => {
  writeFileSync(path.join(outDir, file), JSON.stringify(data));
  console.log(`저장: data/${file}`);
};

// 장소 목록(이름·카테고리)은 config.js가 원본
save('areas.json', POI_LIST.map((p) => ({ cd: p.cd, nm: p.nm, cat: p.category })));

save('current.json', await rpc('site_current'));

let patterns = null;
let reliability = null;
if (mode === 'current') {
  [patterns, reliability] = await Promise.all([fromLiveSite('patterns.json'), fromLiveSite('reliability.json')]);
  if (!patterns || !reliability) console.warn('[참고] 기존 파일 재사용 실패 — 전체 재생성으로 전환');
}
if (!patterns) patterns = await rpc('site_patterns');
if (!reliability) reliability = await rpc('site_reliability');
save('patterns.json', patterns);
save('reliability.json', reliability);

save('meta.json', { built_at: new Date().toISOString(), mode });
console.log(`빌드 완료 (모드: ${mode})`);
