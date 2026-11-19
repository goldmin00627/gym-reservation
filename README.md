# 내손 체육관 예약

학생 예약 화면은 Firebase Hosting, 예약·공지·점검·이용 제한·휴관 기록은 Cloud Firestore, 예약 원본 사진은 Google Drive에 저장합니다. Google Apps Script가 서버에서 관리자 인증과 예약 규칙을 검사합니다.

- 사이트 https://naeson-gym-reservation.web.app
- Firebase 프로젝트 `naeson-gym-reservation-fa397`
- Firestore Standard, 서울 `asia-northeast3`
- 사진 폴더 https://drive.google.com/drive/u/0/folders/1p_ZujlcdwI_xyzIU75RxX74HXuqpfsS6

## 최초 서버 연결

1. Firebase 프로젝트 소유자이자 사진 폴더에 파일을 만들 수 있는 Google 계정으로 https://script.google.com/home/start 에서 새 프로젝트를 만듭니다.
2. 기본 `Code.gs` 내용을 이 저장소 `apps-script/Code.gs`의 전체 내용으로 바꿉니다. HTML 파일은 필요하지 않습니다.
3. 왼쪽 프로젝트 설정에서 ‘편집기에 appsscript.json 매니페스트 파일 표시’를 켭니다. 편집기로 돌아와 `appsscript.json`을 이 저장소의 `apps-script/appsscript.json` 내용으로 바꿉니다.
4. 저장하고 상단 함수 선택 메뉴에서 `setup`을 선택해 실행합니다. Google이 표시하는 Drive 및 데이터베이스 접근 권한을 직접 검토·승인합니다. 실행 로그에 ‘Firestore 연결 완료’가 표시되는지 확인합니다. 새 프로젝트의 관리자 비밀번호는 `0108`로 초기화하며 이후 프로젝트 설정의 스크립트 속성 `ADMIN_PASSWORD`에서 변경합니다.
5. 오른쪽 상단 배포 → 새 배포 → 유형 ‘웹 앱’을 선택합니다. 실행 계정은 ‘나’, 액세스 권한은 ‘모든 사용자’로 지정합니다. 학교 계정에서 이 옵션이 제한되면 도메인 관리자 설정을 확인해야 합니다.
6. 배포한 웹 앱의 `/exec`로 끝나는 URL을 `public/config.js`의 `GAS_URL`에 넣고 Firebase Hosting에 재배포합니다. API URL은 비밀값이 아닙니다. 관리자 비밀번호나 Google OAuth 토큰은 config.js에 넣지 않습니다.
7. 휴대폰에서 예약한 뒤 다른 기기의 관리자 화면에 나타나는지, 원본 사진이 지정 폴더에 생기는지 확인합니다.

Apps Script 웹 앱 배포 주소가 설정되기 전까지 사이트는 브라우저 데모 모드로 실행됩니다. 기존 기기에만 저장된 데모 기록은 Firestore로 자동 이전하지 않습니다.

## 서버 동작

- 모든 예약 요청에서 한국 시간의 예약 주간, 당일·과거 날짜, 2026–2027년 공휴일, 휴관일, 이용 제한, 중복 학번, 코트·휴식 정원, 배구와 대체육관의 상호 배타 규칙을 검사합니다.
- 원본 JPEG 사진은 지정한 Drive 폴더에 저장합니다. 앱은 파일에 공개 권한을 추가하지 않습니다. 접근 권한은 폴더에서 상속하므로 교사의 원본 사진 열람 권한은 폴더 소유자가 관리합니다.
- Firestore의 reservations, inspections, bans, closures, settings 컬렉션에 기록을 저장합니다. `cells` 배열은 기존 필드 순서를 유지합니다. 예약 필드 순서는 Code.gs의 HEADERS.reserve에 정의돼 있습니다. 관리자에게 보여 줄 작은 썸네일과 원본 Drive 링크는 예약 기록에 포함됩니다.
- 변경된 문서와 internal/revision을 한 번에 커밋합니다. Apps Script 잠금과 Firestore 갱신 시각 전제조건을 함께 사용해 동시 요청의 덮어쓰기를 막습니다. 다른 요청이 먼저 저장되면 새로 조회한 뒤 재시도하도록 안내합니다.
- Google IAM으로 인증한 서버가 저장소를 읽고 씁니다. Firestore 클라이언트 규칙은 직접 접근을 전부 차단합니다. 학생 화면에는 날짜별 인원과 공지만 반환하며, 사진과 전체 명단은 서버의 관리자 비밀번호 검사를 거칩니다.
- 학생 화면과 관리자 예약 현황은 보이는 화면에서 20초마다 갱신합니다. 점검·설정 편집 중에는 자동으로 덮어쓰지 않습니다.
- 서버 응답이 유실되면 ‘내 예약 확인’에서 먼저 조회합니다. 예약 자체가 성공한 상황에서 다시 제출하면 중복 학번 검사가 막습니다.
- 원본 사진 저장 이후 Firestore 저장 응답이 불확실한 경우, 이미 저장됐을 가능성이 있는 예약 사진을 지우지 않습니다. 이 경우 예약에 연결되지 않은 사진이 폴더에 남을 수 있습니다.
- 공휴일 자료는 2026·2027년입니다. 새로운 연도와 임시공휴일은 Code.gs와 index.html의 PUBLIC_HOLIDAYS를 갱신하거나 관리자 휴관 기능으로 지정해야 합니다.

## 배포 및 검증

서버 코드를 바꾼 뒤에는 Apps Script에서 배포 → 배포 관리 → 수정 → 새 버전으로 배포합니다. 기존 배포를 수정하면 `/exec` 주소를 유지할 수 있습니다.

```bash
node tests/server.cjs
npx -y firebase-tools@latest deploy --only firestore,hosting --project naeson-gym-reservation-fa397
```

Firestore·Drive 실제 연결은 Google 소유자 권한을 승인하고 위 웹 앱 배포를 완료한 뒤 확인해야 합니다. 테스트는 외부 서비스 응답을 모의하여 예약 규칙, 여러 서버 인스턴스의 공유 저장, 관리자 인증, 원자적 커밋 실패 및 동시 갱신 충돌을 검증합니다.

GitHub Actions의 deploy.yml은 기존 GitHub Pages 배포입니다. GitHub에 올린 변경만으로 Firebase Hosting에 자동 반영되지는 않습니다. Firebase 배포는 위 CLI 명령으로 별도 실행합니다.

## 공식 참고 문서

- https://firebase.google.com/docs/firestore/use-rest-api
- https://developers.google.com/apps-script/guides/web
- https://astro.kasi.re.kr/life/post/calendarData?year=2026
- https://astro.kasi.re.kr/life/post/calendarData?year=2027

## 중학교·고등학교 구분

각 학생에게 학교급(중/고)과 기존 5자리 학번을 함께 입력합니다. 같은 학번이어도 학교급이 다르면 별도 학생으로 예약·조회·이용 제한을 처리합니다. 기존 학교급 없는 기록은 중학교 기록으로 읽습니다. 단체 예약에는 중·고 학생을 함께 추가할 수 있습니다.

이 기능을 적용하려면 새 Code.gs를 Apps Script에 저장하고 배포 관리에서 기존 웹 앱을 새 버전으로 배포해야 합니다. URL은 유지합니다. 이전 서버를 사용하는 동안 고등학교 요청은 화면에서 서버 업데이트 안내로 차단하여 학교급이 누락된 예약이 저장되는 것을 방지합니다.
