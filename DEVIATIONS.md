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

- **운영 3시간차 중간 실측 (2026-08-11 05:26 UTC)**:
  - 행당 데이터 크기: snapshot 306B, forecast 74B, log 76B, raw payload 평균 53.7KB (최대 102KB)
  - 만근 가동(인구 144회/일) 가정 시 하루 증가 추정: snapshot ~7MB + forecast ~3.5MB + raw ~6.4MB + log ~1.9MB ≈ **총 15~19MB/일** (인덱스 포함)
  - 실제 관측 가동률 기준(아래 cron 관측)으로는 **~10~12MB/일** 추정
  - **판정은 지시서대로 24시간 실측 후 확정.** 15MB 초과 시 raw 5곳→2곳 축소(–3.8MB/일) 적용 예정

- **✅ 용량 정식 판정 (2026-08-13, 운영 2.15일차 — 지시서 4-5 이행)**:
  - 테이블 4개 합계 16.5MB / 2.15일 = **하루 약 7.7MB 증가** (raw 10.6MB, forecast 2.5MB, snapshot 2.3MB, log 1.0MB)
  - **판정: 15MB/일 미만 → 통합 raw 5곳 유지, 축소 불필요**
  - 무료 500MB 기준 잔여 여유 약 **2개월**. 60일 지난 raw 삭제 정리 작업은 별도 제안 상태 유지 (약 1개월 내 결정 권장)
  - 누적 호출 5,872회 중 실패 1회(99.98% 성공): POI011 1회 빈 응답 → 설계대로 기록 후 건너뜀, 재발 없음
  - 실효 수집 간격: 스로틀링으로 약 30~60분(가끔 1~2시간 결측). 예측(base_time)은 52시간 동안 13개 시점 확보

- **주간 점검 (2026-08-19, 운영 8.0일차)**:
  - 테이블 합계 74.3MB / 8.0일 = **하루 약 9.3MB** (raw 44.7MB, snapshot 12.6MB, forecast 11.2MB, log 5.8MB)
  - **판정: 15MB/일 미만 → raw 5곳 유지.** DB 전체 85MB/500MB (17% 사용), 현재 속도로 잔여 약 **44일**
  - 누적: snapshot 32,175행 / forecast 56,256행 (base_time 52개 시점) / raw 785건
  - 8/15부터 cron 스로틀링이 완화되어 일일 수집량 2배 이상 증가 (성공 ~2,600 → ~6,000건/일)
  - **신규 관측 — 8/14부터 서울 API 간헐 응답 지연**: http_error 24~65건/일 (평균 41초 소요 후 실패),
    이로 인해 8분 제한 도달 → skipped 218~545건/일 발생. 수집기는 설계대로 동작(기록 후 종료).
    성공 증가분이 더 커서 순 커버리지는 오히려 개선됨. 개선안(HTTP 타임아웃 30초→10초 단축으로
    저속 구간에서 8분 예산 절약)은 사용자 승인 시 적용 예정
  - 60일 raw 정리 작업: 현 속도면 약 6주 후 한도 도달 — **이달 내 도입 결정 권장**

- **✅ 백업+정리 구조 도입 (2026-08-19, 사용자 승인)**:
  - 무료 플랜 유지 결정에 따라 `src/backup.js` + `.github/workflows/backup.yml` 추가 (매주 월요일)
  - 순서 강제: export → git 푸시 성공 → cleanup. 스크립트가 삭제 전 백업 파일 존재를 재확인
  - **보존기간: raw·log 30일** — 지시서 5-3은 60일을 제안했으나, 60일이면 정상 상태 용량(raw만 ~340MB)이
    핵심 데이터 증가분과 합쳐 500MB를 초과함. 백업으로 삭제가 무손실이 되므로 30일로 단축 (보수적 선택)
  - 핵심 테이블(snapshot, forecast)은 삭제 대상에서 제외, 백업만 수행
  - 첫 백업 실측: 8일치 32개 파일 27MB (raw가 25MB — gzip 압축률 약 2배). 저장소 증가 예상 ~90MB/월,
    GitHub 용량 권고(1~5GB) 기준 1년 이상 여유. 장기적으로 오래된 백업을 Releases로 이전하는 방안 있음
  - 정상 상태 예상 DB 용량: raw 30일 ~170MB + log 30일 ~25MB + 핵심 ~90MB/월 증가 → 무료 한도 내 수개월 운영 가능

- **GitHub Actions cron 지연 실측 (2026-08-11)**:
  - `*/10` 스케줄이 실제로는 **약 20~45분 간격**으로 실행됨 (03:56, 04:17, 05:03 관측). 첫 스케줄 실행도 푸시 후 약 1.4시간 뒤 시작
  - 지시서 8절이 경고한 알려진 특성이며 고장 아님. 데이터에 결측 구간이 생기므로 분석 시 균등 간격 가정 금지 (README에 이미 명시됨)
  - 영향: 예측(정시 00~09분 창)이 일부 시간대에 누락될 수 있음. 시간대별 예측 커버리지는 운영 며칠 후 재확인 권장

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
