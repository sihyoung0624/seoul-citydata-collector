# 서울 실시간 도시데이터 수집기

서울시 실시간 인구 데이터(121개 장소)와 12시간 예측값을 **10분마다 자동으로 수집**해서
Supabase 데이터베이스에 쌓는 프로그램입니다.

- 서울시는 과거 데이터를 제공하지 않으므로, **오늘부터 직접 쌓는 것이 시계열을 확보하는 유일한 방법**입니다.
- 사람이 할 일은 **최초 설정 1회**뿐입니다. 이후에는 GitHub이 알아서 계속 실행합니다.
- 화면이나 분석 기능은 없습니다. "끊기지 않고 쌓이는 것"이 목적입니다.

---

## 준비물 (계정 3개)

| 준비물 | 어디서 | 비고 |
|---|---|---|
| GitHub 계정 | github.com | 무료 |
| Supabase 계정 + 프로젝트 1개 | supabase.com | 무료 (이미 사용 중이면 기존 계정) |
| 서울 열린데이터광장 인증키 | data.seoul.go.kr → 로그인 → 나의 화면 → 인증키 관리 | 무료, "일반 인증키" 발급 |

---

## 설치 순서 (클릭 순서대로 따라 하세요)

### 1단계. Supabase에 테이블 만들기

1. [supabase.com](https://supabase.com) 접속 → 로그인 → 사용할 프로젝트 클릭
2. 왼쪽 메뉴에서 **SQL Editor** 클릭
3. **New query** 버튼 클릭
4. 이 저장소의 `sql/001_init.sql` 파일을 열어 **내용 전체를 복사**해서 붙여넣기
5. 오른쪽 아래 **Run** 버튼 클릭
6. "Success. No rows returned" 라고 나오면 성공입니다

### 2단계. Supabase에서 키 2개 찾기 (복사해 두기)

1. Supabase 왼쪽 메뉴 맨 아래 **Project Settings**(톱니바퀴) 클릭
2. **Data API** 메뉴 클릭 → **Project URL** 항목의 주소 복사
   - `https://xxxxxxxx.supabase.co` 모양입니다 → 메모장에 붙여두세요 (=`SUPABASE_URL`)
3. **API Keys** 메뉴 클릭 → **service_role** 항목의 **Reveal**(보기) 클릭 → 키 복사
   - 아주 긴 문자열입니다 → 메모장에 붙여두세요 (=`SUPABASE_SERVICE_KEY`)
   - ⚠️ 이 키는 **모든 권한**을 가집니다. 절대 다른 곳에 붙여넣거나 공유하지 마세요.

> 화면 구성이 조금 다르면: Project Settings 안에서 "API"라고 된 메뉴를 찾으면 됩니다.

### 3단계. GitHub에 저장소 만들고 파일 올리기

1. [github.com](https://github.com) 접속 → 로그인 → 오른쪽 위 **+** → **New repository**
2. Repository name: `seoul-citydata-collector` (원하는 이름 가능)
3. **Public 선택** — 중요합니다. 비공개(Private)면 무료 실행 시간이 부족해 수집이 끊깁니다.
   API 키는 저장소가 아니라 Secrets(금고)에 넣으므로 공개해도 안전합니다.
4. **Create repository** 클릭
5. 파일 올리기 — 둘 중 편한 방법으로:
   - **방법 A (GitHub Desktop, 권장)**: [desktop.github.com](https://desktop.github.com)에서 설치 →
     로그인 → **File > Add local repository** → 이 폴더 선택 → **Publish repository** →
     "Keep this code private" **체크 해제** → Publish
   - **방법 B (웹 업로드)**: 저장소 페이지의 **uploading an existing file** 링크 클릭 →
     이 폴더의 파일·폴더를 전부 드래그해서 업로드 → **Commit changes**
     (⚠️ `.github` 폴더가 꼭 포함되어야 합니다. 안 보이면 방법 A를 쓰세요)

### 4단계. GitHub Secrets에 키 3개 넣기

1. 방금 만든 GitHub 저장소 페이지에서 **Settings** 탭 클릭
2. 왼쪽 메뉴 **Secrets and variables** → **Actions** 클릭
3. **New repository secret** 버튼을 눌러 아래 3개를 **하나씩** 등록:

| Name (정확히 입력) | Secret (값) |
|---|---|
| `SEOUL_API_KEY` | 서울 열린데이터광장 일반 인증키 |
| `SUPABASE_URL` | 2단계에서 복사한 Project URL |
| `SUPABASE_SERVICE_KEY` | 2단계에서 복사한 service_role 키 |

이름에 오타가 있으면 실행이 실패하니 표를 그대로 복사해서 쓰세요.

### 5단계. 첫 수동 실행으로 테스트

1. 저장소 페이지에서 **Actions** 탭 클릭
2. (처음이면 "I understand my workflows, go ahead and enable them" 버튼 클릭)
3. 왼쪽 목록에서 **collect** 클릭
4. 오른쪽의 **Run workflow** 버튼 클릭 → 모드는 **both** 그대로 → 초록색 **Run workflow** 클릭
5. 잠시 후 목록에 실행이 나타납니다. **2~4분** 정도 걸립니다.
6. ✅ 초록 체크 표시가 뜨면 성공, ❌ 빨간 X가 뜨면 클릭해서 오류 메시지를 확인하세요
   (대부분 4단계의 Secret 이름 오타 또는 값 누락입니다)

### 6단계. 데이터가 실제로 들어왔는지 눈으로 확인 (⚠️ 꼭 하세요)

수집기가 돌아가는데 **빈 값만 쌓이는 것**이 이런 작업에서 가장 흔한 사고입니다.
한 달 뒤에 발견하면 그 한 달치는 복구할 수 없습니다. 지금 확인하세요.

1. Supabase 왼쪽 메뉴에서 **Table Editor** 클릭
2. `ppltn_snapshot` 테이블 클릭 → 확인할 것:
   - 행이 **약 121개** 있는가 (일부 실패는 정상)
   - `ppltn_min` 열에 `24000` 같은 **숫자**가 들어있는가 (비어있으면 문제)
   - `area_nm` 열에 `광화문·덕수궁` 같은 장소 이름이 보이는가
3. `collection_log` 테이블 클릭 → `status` 열이 대부분 `success`인지 확인
4. `citydata_raw` 테이블 클릭 → 행이 5개 있고 `payload`에 긴 JSON이 들어있는지 확인
   - 여기가 0개라면 아래 [문제해결](#문제해결)의 "citydata가 실패해요" 참조
5. `ppltn_forecast` 테이블은 매 수집마다 함께 쌓입니다 (중복 예측은 자동으로 무시됨).
   행이 계속 늘어나는지 확인하세요.
   ※ 2026-09-03 이전에는 정시 근처 데이터에만 저장하는 규칙이었습니다 — 변경 경위는 DEVIATIONS.md 참조.

여기까지 확인되면 **설정 끝**입니다. 이후 10분마다(인구), 60분마다(통합) 자동 수집됩니다.

---

## 다음 날 확인할 것 (1회)

첫 24시간 운영 후, `DEVIATIONS.md`의 5번 항목에 있는 용량 측정 SQL을
Supabase SQL Editor에서 실행하고 결과를 그 파일에 기록해 주세요.
(하루 증가량이 15MB를 넘으면 수집 대상을 줄여야 합니다 — 방법도 같은 파일에 있습니다)

---

## 자동 백업과 용량 정리 (2026-08-19 추가)

무료 500MB 한도 안에서 계속 운영하기 위해 매주 월요일 자동으로 다음이 실행됩니다:

1. **백업**: 완료된 날짜의 데이터 전체를 하루 1파일(`backup/테이블명/날짜.ndjson.gz`)로
   압축해 이 저장소에 보관합니다. 삭제 여부와 관계없이 **모든 데이터의 사본이 영구 보존**됩니다.
2. **정리**: 백업이 저장소에 안전하게 올라간 것을 확인한 뒤에만, 30일 지난
   통합 원본(citydata_raw)과 실행 로그(collection_log)를 DB에서 삭제합니다.
3. **핵심 데이터(실측 ppltn_snapshot, 예측 ppltn_forecast)는 DB에서 삭제하지 않습니다.**
   백업은 재해 대비용으로만 함께 만들어집니다.

백업 파일 읽는 법(개발팀용): gzip 압축을 풀면 한 줄에 한 행(JSON)인 NDJSON 형식입니다.
예: `zcat backup/ppltn_snapshot/2026-08-12.ndjson.gz | head`

## 알아두어야 할 것

- **실행 시각은 정확하지 않습니다.** GitHub Actions의 스케줄은 UTC 기준이며 부하에 따라
  수 분 지연되거나 가끔 건너뛸 수 있습니다. 데이터가 쌓이는 데는 문제없지만,
  **분석할 때 "정확히 10분 간격"이라고 가정하면 안 됩니다** (결측 구간 존재 가능).
- **60일간 커밋이 없으면 GitHub이 스케줄을 자동으로 끕니다.**
  이를 막는 keepalive 워크플로(월 1회 빈 커밋)가 포함되어 있으므로 별도 조치는 필요 없습니다.
  다만 Actions 탭에서 "Scheduled workflow disabled" 배너가 보이면 **Enable** 버튼을 눌러 주세요.
- **API 키를 코드에 절대 넣지 마세요.** 키는 GitHub Secrets에만 존재해야 합니다.
- **데이터 성질**: 인구수는 2,000명 폭 구간 추정치이며, 혼잡도는 최근 28일 평균 대비 상대값입니다.
- **출처표시 의무**: 이 데이터는 공공누리 1유형입니다. 외부 공개 자료에 사용할 때
  "출처: 서울 열린데이터광장"을 표시해야 합니다.

## 문제해결

| 증상 | 원인/조치 |
|---|---|
| Actions 실행이 ❌ 실패 | 실행 클릭 → 로그 확인. `환경변수 ...가 설정되지 않았습니다`면 4단계 Secret 이름 오타 |
| `ppltn_snapshot`이 비어 있음 | `collection_log`의 `error_msg` 확인. `api_error`면 서울 API 키 문제(발급 직후엔 반영까지 시간이 걸릴 수 있음) |
| **citydata만 실패해요** (`api_error`) | 통합 API 서비스명이 다른 경우입니다. 열린데이터광장에서 데이터셋 **OA-21285** 검색 → Open API 탭에서 서비스명 확인 → GitHub 저장소에서 `src/config.js` 열고 연필 아이콘(편집) → `SERVICE_CITYDATA: 'citydata'`의 값을 확인한 이름으로 수정 → Commit. 그리고 `DEVIATIONS.md`에 기록 |
| 수집이 며칠째 안 돌아감 | Actions 탭에서 워크플로가 비활성화됐는지 확인 → Enable 클릭 |

## 파일 구성 (개발팀 전달용)

```
├─ .github/workflows/collect.yml    # 수집 스케줄 (인구 10분, 통합 60분, 수동 실행 포함)
├─ .github/workflows/keepalive.yml  # 60일 비활성화 방지 (월 1회 빈 커밋)
├─ src/
│   ├─ config.js                    # 121개 장소 목록 + 상수 (자동 생성 — 수동 편집 금지)
│   ├─ seoul-api.js                 # 서울 API 호출 + 재시도(2회) + 키 마스킹
│   ├─ parser.js                    # 문자열 → 정수/숫자/KST시각 변환, 예측 저장 규칙
│   ├─ db.js                        # Supabase REST 저장 (중복은 조용히 무시)
│   └─ index.js                     # 진입점 (모드: ppltn / citydata / both)
├─ sql/001_init.sql                 # 테이블 4개 + 인덱스 + RLS
├─ .env.example                     # 필요한 환경변수 견본 (실제 값 없음)
├─ DEVIATIONS.md                    # 계획 이탈 기록 + 용량 측정 SQL
└─ README.md
```

- 실행 환경: Node.js 20 이상, 외부 패키지 의존성 없음 (`npm install` 불필요)
- DB 저장: Supabase REST API 직접 호출, `ON CONFLICT DO NOTHING` 동등 처리로 중복 안전
- 보안: RLS 활성화(익명 차단), service_role 키는 GitHub Secrets 전용, 로그에 키 마스킹
