# DEVIATIONS.md — 계획 이탈 기록

지시서 0번 원칙에 따라, 계획에서 벗어난 지점을 사유와 함께 기록한다.
구현 자체를 막는 이탈은 없었으며, 아래는 모두 보수적 선택이다.

---

## 1. Supabase 저장을 공식 라이브러리 대신 REST API 직접 호출로 구현

- **지시서**: 저장 방식 라이브러리를 특정하지 않음
- **선택**: `@supabase/supabase-js` 대신 Supabase REST API(PostgREST)를 Node 내장 `fetch`로 직접 호출
- **사유**: 외부 의존성이 0개가 되어 GitHub Actions에서 `npm install` 단계가 불필요하다.
  실행 시간이 짧아지고(10분 주기 실행에 유리), 의존성 업데이트로 수집이 깨질 위험이 없다.
  이 프로젝트는 INSERT만 수행하므로 REST 호출로 충분하다.
- **중복 처리**: `ON CONFLICT DO NOTHING`은 PostgREST의 `Prefer: resolution=ignore-duplicates` 헤더로 동일하게 구현됨

## 2. keepalive를 별도 워크플로 파일로 추가

- **지시서**: 8절 파일 트리에는 `collect.yml`만 있으나, 본문에서 월 1회 keepalive 워크플로를 요구
- **선택**: `.github/workflows/keepalive.yml`로 분리 (매월 1일 빈 커밋)
- **사유**: 수집 워크플로에 커밋 권한(`contents: write`)을 주지 않기 위함. 권한 최소화 원칙

## 3. collection_log의 status에 'skipped' 값 추가

- **지시서**: status 예시는 success / api_error / http_error / parse_error 4종
- **선택**: 8분 초과로 건너뛴 장소를 `skipped`로 기록
- **사유**: 지시서 4-4가 "남은 장소를 건너뛰고 로그에 기록"을 요구하는데, 기존 4종으로는
  '실패'와 '시간 초과로 미시도'를 구분할 수 없다. 컬럼이 text라 스키마 변경은 없음

## 4. 통합 API 서비스명 `citydata` — ✅ 검증 완료 (2026-08-11)

- **지시서**: 실제 호출해 검증하고 실패 시 수정하라고 요구 (3-2)
- **결과**: 실제 키로 호출해 확인 완료. 서비스명 `citydata` **정상** (INFO-000, `CITYDATA` 블록 포함 응답 수신)
- 수정 불필요. `src/config.js` 그대로 사용

## 5. 용량 실측(지시서 4-5) — 운영 24시간 후 수행 예정

- **상태**: 아직 운영 전이므로 측정 불가. 첫 24시간 운영 후 아래 SQL을 Supabase SQL Editor에서 실행해
  결과를 이 파일에 추가 기록할 것.

```sql
-- citydata_raw.payload 1건 평균 크기 (바이트)
select round(avg(pg_column_size(payload))) as avg_payload_bytes,
       max(pg_column_size(payload))        as max_payload_bytes,
       count(*)                            as rows
from citydata_raw;

-- 테이블 4개의 현재 총 용량 (하루 운영 후 값 ≒ 하루 증가량)
select relname as table_name,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_catalog.pg_statio_user_tables
where relname in ('ppltn_snapshot', 'ppltn_forecast', 'citydata_raw', 'collection_log')
order by pg_total_relation_size(relid) desc;
```

- **판정 기준**: 하루 증가량 합계가 15MB를 넘으면 `src/config.js`의 `RAW_TARGETS`를
  5곳 → 2곳(POI009, POI014)으로 줄이고 이 파일에 기록
- **첫 실행 실측 (2026-08-11)**: `citydata_raw.payload` 평균 **53.6KB/건**
  - 지시서 5-3 기준(50KB) 초과 → **60일치 보관 후 삭제하는 정리 작업을 별도 제안함** (지시서에 따라 이번 구현에는 미포함)
  - raw 하루 예상: 5곳 × 24회 × 53.6KB ≈ 6.3MB/일. 스냅샷·예측·로그 포함 총량은 24시간 후 실측할 것

## 6. 로컬 원본 파일들을 저장소 커밋에서 제외

- **지시서**: 8절 산출물 트리에 지시서(md), poi.xlsx, files.zip이 없음
- **선택**: `.gitignore`로 루트의 원본 4개(files.zip, poi.xlsx, 지시서 md, 루트 config.js)를 커밋 제외.
  `src/config.js`는 산출물이므로 커밋에 포함
- **사유**: 저장소는 public이므로 산출물 트리에 명시된 파일만 공개하는 것이 보수적

## 7. 설치 환경 기록 (2026-08-11, 사용자 승인 하에 진행)

- Supabase 무료 계정의 활성 프로젝트 한도(2개) 때문에 신규 생성이 거부됨
- 사용자 선택에 따라 `kids-schedule-push` 프로젝트를 **일시정지**(데이터 보존, 언제든 재개 가능)하고
  수집기 전용 프로젝트 **`seoul-citydata`** (ref: `mqkgocpipaftnprcnsjr`, 서울 리전 ap-northeast-2) 생성
- `sql/001_init.sql`과 동일한 스키마를 마이그레이션 `init_collector_tables`로 적용 완료 (테이블 4개, RLS 활성 확인)
- GitHub 저장소: https://github.com/sihyoung0624/seoul-citydata-collector (public)
- GitHub Secrets: `SUPABASE_URL` 등록 완료. `SEOUL_API_KEY`, `SUPABASE_SERVICE_KEY`는 사용자만 아는 값이라 미등록

## 8. 그 외

- 121곳 목록은 제공된 `config.js`를 **수정 없이 그대로** `src/config.js`로 사용함 (지시서·사용자 지시 준수)
- 지시서 부록 A 샘플로 파싱 로직 오프라인 검증 28건 전체 통과 (정수 변환, KST 시각, 분 00~09 규칙, base_time 복사, 방어 규칙)
- 위 4·5번 외 이탈 사항 **없음**
