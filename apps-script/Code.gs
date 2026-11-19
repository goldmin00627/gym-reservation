/**
 * 체육관 예약 관리 — Google Apps Script
 *
 * [구글만으로 운영]  이 파일(Code.gs) + HTML 파일 'index'(= index.html 내용) 두 개를 Apps Script에 넣고
 *                   웹 앱으로 배포하면, 배포 주소 하나로 화면과 저장이 모두 돌아갑니다.
 * [GitHub Pages 등] 화면(public/)은 GitHub에, 이 파일은 Apps Script에 두고 config.js의 GAS_URL로 연결 (doPost 사용).
 *
 * 관리자 비밀번호는 코드에 적지 않습니다. (GitHub에 공개되므로)
 *   Apps Script [프로젝트 설정 ⚙ > 스크립트 속성]에 ADMIN_PASSWORD 를 추가하세요.
 *
 * 시트 구성 (setup 실행 시 자동 생성)
 *   예약     : 학생 예약 (장소 = 코트 1~5 / 휴식 / 배구), 예약번호, 대표 사진 링크
 *   점검기록 : 이용일별 관리 점검 (같은 날짜를 다시 저장하면 덮어씀)
 *   이용제한 : 무기한 또는 n일(등교일 기준) 이용 정지 학생
 *   휴관일   : 관리자가 체육관을 닫은 날짜 (예약을 받지 않음)
 *   설정     : 공지사항(종류=공지, C열 작은 바/긴 바)과 휴식 최대 인원(종류=휴식정원)
 *
 * 예약 기간
 *   - 매주 일요일 오후 5시에 다음 주 월~금 예약이 열림 (예: 10/11(일) 17시 → 10/12~10/16)
 *   - 그 주 안에서 학생이 날짜를 골라 예약. 당일·지난 날짜·휴관일은 예약 불가
 *   - 토요일 ~ 일요일 오후 5시 전에는 이번 주 것만 보이므로 사실상 예약 불가
 *
 * 예약 규칙
 *   - 코트 하나에 최대 4명. 단체(2~4명)가 예약하면 그 코트는 마감, 개인은 4명까지 함께 사용
 *   - 대체육관 = 코트 1~4, 소체육관 = 코트 5
 *   - 휴식: 기본 최대 30명
 *   - 배구: 대체육관 전체(코트 1~4) 사용, 10~20명. 먼저 들어온 예약이 우선
 *       · 배구가 먼저 → 코트 1~4 예약 불가
 *       · 코트 1~4에 예약이 하나라도 먼저 → 배구 예약 불가
 *   - 예약번호: 일반 01~99, 배구 100~120 (날짜마다 겹치지 않게 무작위)
 *   - 조회·취소·인원 수정은 학번 + 이름 + 예약번호가 모두 맞아야 가능
 *   - 관리자가 취소할 때는 사유 필수 → 학생이 [내 예약 확인]에서 사유를 볼 수 있음
 *   - 휴관으로 취소된 예약의 사유: '체육관 개방하지 않음'
 */

const CONFIG = {
  MAX_GROUP: 4,                    // 코트·휴식 단체 최대 인원
  COURT_MAX: 4,                    // 코트 하나당 최대 인원
  VOLLEY_MIN: 10,                  // 배구 최소 인원
  VOLLEY_MAX: 20,                  // 배구 최대 인원
  DEFAULT_REST_CAPACITY: 30,       // 휴식 최대 인원 기본값 (관리자 페이지에서 변경 가능)
  PHOTO_FOLDER_NAME: '체육관 예약 사진',
  OPEN_WEEKDAY: 0,                 // 다음 주 예약이 열리는 요일 (0 = 일요일)
  OPEN_HOUR: 17,                   // 열리는 시각 (17 = 오후 5시)
  TIMEZONE: 'Asia/Seoul',
  SHEET_RESERVE: '예약',
  SHEET_INSPECTION: '점검기록',
  SHEET_BAN: '이용제한',
  SHEET_CLOSED: '휴관일',
  SHEET_SETTINGS: '설정'
};
const CLOSED_REASON = '체육관 개방하지 않음';

const COURTS = ['코트 1', '코트 2', '코트 3', '코트 4', '코트 5'];
const BIG_COURTS = ['코트 1', '코트 2', '코트 3', '코트 4'];   // 대체육관
const REST = '휴식';
const VOLLEY = '배구';
const PLACES = COURTS.concat([REST, VOLLEY]);

const HEADERS = {
  reserve: ['예약번호', '이용일', '접수일시', '장소', '구분', '인원', '대표 학번', '대표 이름', '함께하는 학생',
            '상태', '변경일시', '취소 사유', '대표 사진', '사진 파일 ID', '썸네일(앱 표시용)'],
  closed: ['날짜', '메모', '등록일시', '상태', '변경일시'],
  inspection: ['이용일', '점검일시', '점검자', '용구 정리', '쓰레기·청결', '안전 문제', '그 밖의 문제', '종합', '특이사항'],
  ban: ['제한번호', '학번', '이름', '구분', '시작일', '종료일', '일수', '사유', '등록일시', '상태', '해제일시'],
  settings: ['종류', '내용', '크기']
};
// 열 위치 (0부터)
const RC = { CODE: 0, DATE: 1, CREATED: 2, PLACE: 3, TYPE: 4, COUNT: 5, REP_ID: 6, REP_NAME: 7, OTHERS: 8, STATUS: 9, UPDATED: 10, REASON: 11, PHOTO: 12, PHOTO_ID: 13, THUMB: 14 };
const BC = { ID: 0, SID: 1, NAME: 2, KIND: 3, START: 4, END: 5, DAYS: 6, REASON: 7, CREATED: 8, STATUS: 9, LIFTED: 10 };

// 관리 점검 항목 — good(문제 없음) / bad(문제 있음) 답 (index.html의 INSPECT_ITEMS와 같게)
const INSPECT_ITEMS = [
  { key: 'equipment',   good: '양호', bad: '불량' },  // 1. 용구 정리 상태
  { key: 'cleanliness', good: '양호', bad: '불량' },  // 2. 쓰레기 및 청결 상태
  { key: 'safety',      good: '없음', bad: '있음' },  // 3. 안전 문제가 있었는가?
  { key: 'other',       good: '없음', bad: '있음' }   // 4. 그 밖의 문제가 있었는가?
];
const NOTICE_MAX = { short: 60, long: 500 };
const SIZE_LABEL = { short: '작은 바', long: '긴 바' };

const DEFAULT_NOTICES = [
  { size: 'short', text: '실내화 착용 필수, 외부 신발은 입구 신발장에' },
  { size: 'short', text: '음식물·음료 반입 금지 (물은 허용)' },
  { size: 'short', text: '사용한 공과 용구는 제자리에 정리' },
  { size: 'short', text: '점심시간 종료 5분 전까지 퇴실' },
  { size: 'long',  text: '예약한 곳만 사용할 수 있습니다. 예약번호는 꼭 기억해 두고, 못 오게 되면 [내 예약 확인]에서 취소해 주세요.\n학교 사정이나 관리자 판단에 따라 예약이 임의로 취소될 수 있으며, 취소 사유는 [내 예약 확인]에서 볼 수 있습니다.' }
];

/* =========================================================
   최초 1회 실행: 편집기 상단에서 함수 'setup' 선택 → 실행
   ========================================================= */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);
  sheet_(CONFIG.SHEET_RESERVE, HEADERS.reserve);
  sheet_(CONFIG.SHEET_INSPECTION, HEADERS.inspection);
  sheet_(CONFIG.SHEET_BAN, HEADERS.ban);
  sheet_(CONFIG.SHEET_CLOSED, HEADERS.closed);
  const s = sheet_(CONFIG.SHEET_SETTINGS, HEADERS.settings);
  if (s.getLastRow() < 2) writeSettings_(DEFAULT_NOTICES, CONFIG.DEFAULT_REST_CAPACITY);
  const folder = photoFolder_();
  Logger.log('준비 완료! 사진 폴더: ' + folder.getUrl());
  if (!adminPassword_()) Logger.log('⚠ 관리자 비밀번호가 아직 없습니다. [프로젝트 설정 > 스크립트 속성]에 ADMIN_PASSWORD 를 추가하세요.');
}

/* ---------- 웹 앱 진입점 ---------- */
// 배포 주소를 열면 예약 화면(HTML 파일 'index')을 보여 줌
function doGet() {
  try {
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('체육관 예약')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover') // 폰 화면 맞춤 (HTML 안의 meta는 무시됨)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);                   // 구글 사이트 등에 넣을 수 있게
  } catch (err) {
    // 'index' 파일 없이 서버로만 쓰는 경우 (화면을 Netlify 등에 올렸을 때)
    return json_({ ok: true, message: '체육관 예약 API가 작동 중입니다.' });
  }
}

// 화면(같은 구글 프로젝트 안)에서 google.script.run.api(...)로 호출
function api(p) {
  return route_(p);
}

// 화면을 다른 곳에 올렸을 때 GAS_URL로 들어오는 요청
function doPost(e) {
  let p;
  try { p = JSON.parse((e && e.postData && e.postData.contents) || ''); }
  catch (err) { return json_({ ok: false, error: '요청 데이터가 올바르지 않습니다.' }); }
  return json_(route_(p));
}

function route_(p) {
  try {
    const handlers = {
      public: handlePublic_, checkBan: handleCheckBan_, reserve: handleReserve_,
      lookup: handleLookup_, cancel: handleCancel_, updateMembers: handleUpdateMembers_,
      login: handleLogin_, admin: handleAdmin_, adminCancel: handleAdminCancel_, inspection: handleInspection_,
      saveSettings: handleSaveSettings_, addBan: handleAddBan_, liftBan: handleLiftBan_, setClosed: handleSetClosed_
    };
    const fn = handlers[p && p.action];
    if (!fn) throw new Error('알 수 없는 요청입니다.');
    return fn(p);
  } catch (err) {
    console.error(err);
    return { ok: false, error: errMsg_(err) };
  }
}

// 관리자 로그인 — 비밀번호는 서버에서만 확인
function handleLogin_(p) {
  checkPassword_(p.password);
  return { ok: true };
}

/* ---------- 장소 점유와 규칙 ---------- */
function occupancy_(active) {
  const occ = {};
  PLACES.forEach(function (p) { occ[p] = { people: 0, group: false }; });
  active.forEach(function (r) {
    const o = occ[r.place];
    if (!o) return;
    o.people += r.members.length;
    if (r.type === '단체') o.group = true;
  });
  return occ;
}

// 예약할 수 없으면 이유를, 가능하면 '' 를 돌려줌
function placeError_(place, type, n, occ, restCap) {
  if (place === VOLLEY) {
    if (type !== '단체') return '배구는 단체로만 예약할 수 있습니다.';
    if (occ[VOLLEY].people > 0) return '이 날은 이미 배구 예약이 있습니다.';
    if (BIG_COURTS.some(function (c) { return occ[c].people > 0; })) return '대체육관 코트에 먼저 들어온 예약이 있어 배구를 예약할 수 없습니다.';
    if (n < CONFIG.VOLLEY_MIN) return '배구는 ' + CONFIG.VOLLEY_MIN + '명 이상이어야 예약할 수 있습니다.';
    return '';
  }
  if (place === REST) {
    const left = restCap - occ[REST].people;
    if (n > left) return left > 0 ? '휴식 자리가 ' + left + '명 남아 ' + n + '명은 예약할 수 없습니다.' : '휴식 자리가 마감되었습니다.';
    return '';
  }
  if (BIG_COURTS.indexOf(place) >= 0 && occ[VOLLEY].people > 0) return '배구 예약이 먼저 들어와 대체육관 전체를 사용합니다.';
  const o = occ[place];
  if (type === '단체') return o.people > 0 ? place + ' 자리에 이미 다른 학생이 예약되어 단체로 쓸 수 없습니다. 비어 있는 코트를 고르세요.' : '';
  if (o.group || o.people >= CONFIG.COURT_MAX) return place + ' 자리가 마감되었습니다.';
  return '';
}

function validateMembers_(type, members, place) {
  if (type !== '개인' && type !== '단체') throw new Error('예약 구분을 선택하세요.');
  const list = (Array.isArray(members) ? members : []).map(function (m) {
    return { id: String((m && m.id) || '').trim(), name: String((m && m.name) || '').replace(/[,\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20) };
  });
  if (place === VOLLEY) {
    if (type !== '단체') throw new Error('배구는 단체로만 예약할 수 있습니다.');
    if (list.length < CONFIG.VOLLEY_MIN || list.length > CONFIG.VOLLEY_MAX) throw new Error('배구는 ' + CONFIG.VOLLEY_MIN + '~' + CONFIG.VOLLEY_MAX + '명이어야 합니다.');
  } else {
    if (type === '개인' && list.length !== 1) throw new Error('개인 예약은 1명만 등록합니다.');
    if (type === '단체' && (list.length < 2 || list.length > CONFIG.MAX_GROUP)) throw new Error('단체 예약은 2~' + CONFIG.MAX_GROUP + '명입니다.');
  }
  const seen = {};
  list.forEach(function (m, i) {
    if (!/^\d{5}$/.test(m.id)) throw new Error((i + 1) + '번째 학생의 학번을 5자리 숫자로 입력하세요.');
    if (!m.name) throw new Error((i + 1) + '번째 학생의 이름을 입력하세요.');
    if (seen[m.id]) throw new Error('학번 ' + m.id + '이(가) 두 번 입력되었습니다.');
    seen[m.id] = true;
  });
  return list;
}

/* ---------- 예약 기간: 매주 일요일 오후 5시에 다음 주(월~금)가 열림 ---------- */
function openWeek_() {
  const now = new Date();
  const today = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'H'));
  const w = utc_(today).getUTCDay();
  const sinceOpen = (w - CONFIG.OPEN_WEEKDAY + 7) % 7;                 // 가장 최근 오픈 요일로부터 지난 날 수
  let openDay = addDays_(today, -sinceOpen);
  if (sinceOpen === 0 && hour < CONFIG.OPEN_HOUR) openDay = addDays_(openDay, -7); // 오픈 시각 전이면 지난주 오픈 기준
  // 오픈 요일 다음에 오는 월요일부터 금요일까지
  let monday = addDays_(openDay, 1);
  while (utc_(monday).getUTCDay() !== 1) monday = addDays_(monday, 1);
  const days = [0, 1, 2, 3, 4].map(function (i) { return addDays_(monday, i); });
  const nextOpen = addDays_(openDay, 7);
  return { today: today, days: days, nextOpen: nextOpen, nextOpenLabel: fmtKo_(nextOpen) + ' 오후 ' + (CONFIG.OPEN_HOUR > 12 ? CONFIG.OPEN_HOUR - 12 : CONFIG.OPEN_HOUR) + '시' };
}

// 날짜가 예약 가능한지 — 불가능하면 이유
function dateError_(date, week, closed) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return '예약할 날짜를 선택하세요.';
  if (date <= week.today) return '지난 날짜나 오늘은 예약할 수 없습니다.';
  if (week.days.indexOf(date) < 0) return '아직 예약할 수 없는 날짜입니다. 다음 주 예약은 ' + week.nextOpenLabel + '에 열립니다.';
  if (closed[date]) return fmtKo_(date) + '은 체육관을 열지 않습니다.';
  return '';
}

/* ---------- 학생: 예약 현황 (이번 예약 주간 5일) ---------- */
function handlePublic_() {
  const week = openWeek_();
  const settings = readSettings_();
  const closed = readClosed_();
  const all = readReservations_(false).filter(function (r) { return r.status === '예약'; });
  const days = week.days.map(function (d) {
    return {
      date: d, past: d <= week.today, closed: !!closed[d], closedMemo: closed[d] ? closed[d].memo : '',
      occupancy: occupancy_(all.filter(function (r) { return r.date === d; }))
    };
  });
  return { ok: true, today: week.today, days: days, nextOpen: week.nextOpenLabel, restCapacity: settings.restCapacity, notices: settings.notices };
}

/* ---------- 학생: 이용 제한 확인 ---------- */
function handleCheckBan_(p) {
  const id = String(p.studentId || '').trim();
  if (!/^\d{5}$/.test(id)) return { ok: true, banned: false };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) ? p.date : nextSchoolDay_(today_());
  const ban = activeBanFor_(readBans_(), id, date);
  return ban ? { ok: true, banned: true, message: banMessage_(ban) } : { ok: true, banned: false };
}

function checkBans_(members, date) {
  const bans = readBans_();
  members.forEach(function (m) {
    const ban = activeBanFor_(bans, m.id, date);
    if (ban) throw new Error(m.id + ' ' + m.name + ' 학생은 ' + banMessage_(ban).replace(/학생이에요.*$/, '학생이라 예약할 수 없습니다.'));
  });
}

/* ---------- 학생: 예약 ---------- */
function handleReserve_(p) {
  const target = String(p.date || '');
  const dErr = dateError_(target, openWeek_(), readClosed_());
  if (dErr) throw new Error(dErr);
  if (PLACES.indexOf(p.place) < 0) throw new Error('예약할 장소를 선택하세요.');
  const members = validateMembers_(p.type, p.members, p.place);
  if (p.agreePrivacy !== true || p.agreePenalty !== true) throw new Error('동의 항목에 모두 체크해야 예약할 수 있습니다.');
  if (!p.photo || !p.thumb) throw new Error('대표 학생 얼굴 사진을 촬영하세요.');
  const thumb = checkImage_(p.thumb, 45000, '썸네일');
  checkBans_(members, target);

  // 사진 업로드는 잠금 밖에서 (동시 접속 대기 최소화) — 예약이 거절되면 지움
  const photo = savePhoto_(p.photo, target, members[0]);
  try {
    return withLock_(function () {
      if (readClosed_()[target]) throw new Error(fmtKo_(target) + '은 체육관을 열지 않습니다.');
      const all = readReservations_(false);
      const active = all.filter(function (r) { return r.date === target && r.status === '예약'; });
      members.forEach(function (m) {
        const dup = active.some(function (r) { return r.members.some(function (x) { return x.id === m.id; }); });
        if (dup) throw new Error(m.id + ' ' + m.name + ' 학생은 이미 ' + fmtKo_(target) + '에 예약되어 있습니다.');
      });
      const err = placeError_(p.place, p.type, members.length, occupancy_(active), readSettings_().restCapacity);
      if (err) throw new Error(err);

      const code = newCode_(all, target, p.place === VOLLEY);
      const created = stamp_();
      appendText_(sheet_(CONFIG.SHEET_RESERVE, HEADERS.reserve), [
        code, target, created, p.place, p.type, members.length, members[0].id, safe_(members[0].name), safe_(othersText_(members)),
        '예약', '', '', photo.url, photo.id, thumb
      ]);
      return { ok: true, reservation: { key: target + '#' + code, code: code, createdAt: created, date: target, place: p.place, type: p.type, members: members, status: '예약', updatedAt: '' } };
    });
  } catch (err) {
    try { DriveApp.getFileById(photo.id).setTrashed(true); } catch (e) { /* 무시 */ }
    throw err;
  }
}

// 같은 날짜에 겹치지 않는 예약번호 (일반 01~99, 배구 100~120)
function newCode_(all, date, volley) {
  const from = volley ? 100 : 1, to = volley ? 120 : 99;
  const sameDay = all.filter(function (r) { return r.date === date; });
  const pick = function (used) {
    const free = [];
    for (let n = from; n <= to; n++) { const c = n < 10 ? '0' + n : String(n); if (!used[c]) free.push(c); }
    return free.length ? free[Math.floor(Math.random() * free.length)] : '';
  };
  const usedAll = {}, usedActive = {};
  sameDay.forEach(function (r) { usedAll[r.code] = true; if (r.status === '예약') usedActive[r.code] = true; });
  const code = pick(usedAll) || pick(usedActive);
  if (!code) throw new Error('이 날은 더 이상 예약번호를 만들 수 없습니다. 관리자에게 문의하세요.');
  return code;
}

function checkImage_(dataUrl, maxChars, label) {
  const s = String(dataUrl || '');
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s)) throw new Error(label + ' 형식이 올바르지 않습니다. 다시 촬영하세요.');
  if (s.length > maxChars) throw new Error(label + ' 용량이 너무 큽니다. 다시 촬영하세요.');
  return s;
}

function savePhoto_(dataUrl, date, rep) {
  const s = checkImage_(dataUrl, 3 * 1024 * 1024, '사진');
  const bytes = Utilities.base64Decode(s.split(',')[1]);
  const fileName = date.replace(/-/g, '') + '_' + rep.id + '_' + rep.name.replace(/[\\/:*?"<>|]/g, '') + '_' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HHmmss') + '.jpg';
  // 파일은 비공개로 저장됩니다 (스프레드시트 소유자만 열람 가능)
  const file = photoFolder_().createFile(Utilities.newBlob(bytes, 'image/jpeg', fileName));
  return { id: file.getId(), url: file.getUrl() };
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* 새로 만듦 */ }
  }
  const it = DriveApp.getFoldersByName(CONFIG.PHOTO_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

/* ---------- 학생: 내 예약 (학번 + 이름 + 예약번호) ---------- */
function normCode_(c) {
  const s = String(c || '').trim();
  return /^\d$/.test(s) ? '0' + s : s;
}
function credentials_(p) {
  const id = String(p.studentId || '').trim(), name = String(p.name || '').trim(), code = normCode_(p.code);
  if (!/^\d{5}$/.test(id) || !name) throw new Error('학번 5자리와 이름을 입력하세요.');
  if (!/^\d{2,3}$/.test(code)) throw new Error('예약번호를 입력하세요.');
  return { id: id, name: name, code: code };
}
const isMine_ = function (r, c) { return r.code === c.code && r.members.some(function (m) { return m.id === c.id && m.name === c.name; }); };

function handleLookup_(p) {
  const c = credentials_(p);
  const since = addDays_(today_(), -60);
  const list = readReservations_(false).filter(function (r) { return r.date >= since && isMine_(r, c); })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  if (!list.length) throw new Error('학번·이름·예약번호가 맞는 예약이 없습니다. 다시 확인하세요.');
  return { ok: true, today: today_(), reservations: list.map(function (r) { return publicRes_(r, false); }) };
}

function findMine_(p) {
  const c = credentials_(p);
  const r = findReservation_(p.key);
  if (!r || r.status !== '예약' || !isMine_(r, c)) throw new Error('학번·이름·예약번호가 맞는 예약이 없습니다. 다시 조회하세요.');
  if (r.date < today_()) throw new Error('지난 예약은 바꿀 수 없습니다.');
  return r;
}

function handleCancel_(p) {
  return withLock_(function () {
    const r = findMine_(p);
    setStatus_(r.row, '취소', '');
    return { ok: true };
  });
}

// 단체 인원 수정 (대표 학생은 바꿀 수 없음 — 사진이 대표 얼굴이므로)
function handleUpdateMembers_(p) {
  return withLock_(function () {
    const r = findMine_(p);
    if (r.type !== '단체') throw new Error('개인 예약은 인원을 바꿀 수 없습니다. 취소 후 다시 예약하세요.');
    const members = validateMembers_('단체', p.members, r.place);
    if (members[0].id !== r.members[0].id) throw new Error('대표 학생은 바꿀 수 없습니다. 대표를 바꾸려면 취소 후 다시 예약하세요.');
    checkBans_(members, r.date);
    const others = readReservations_(false).filter(function (x) { return x.date === r.date && x.status === '예약' && x.key !== r.key; });
    members.forEach(function (m) {
      if (others.some(function (x) { return x.members.some(function (y) { return y.id === m.id; }); })) {
        throw new Error(m.id + ' ' + m.name + ' 학생은 이미 ' + fmtKo_(r.date) + '에 다른 예약이 있습니다.');
      }
    });
    if (r.place === REST) {
      const left = readSettings_().restCapacity - people_(others.filter(function (x) { return x.place === REST; }));
      if (members.length > left) throw new Error('휴식 자리가 ' + left + '명 남아 ' + members.length + '명으로 바꿀 수 없습니다.');
    }
    const sh = sheet_(CONFIG.SHEET_RESERVE, HEADERS.reserve);
    sh.getRange(r.row, RC.COUNT + 1, 1, 6).setNumberFormat('@').setValues([[
      String(members.length), members[0].id, safe_(members[0].name), safe_(othersText_(members)), '예약', stamp_()
    ]]);
    return { ok: true, members: members };
  });
}

/* ---------- 관리자 ---------- */
function handleAdmin_(p) {
  checkPassword_(p.password);
  const date = String(p.date || '');
  checkDate_(date);
  const dates = (Array.isArray(p.dates) ? p.dates : []).slice(0, 14).map(String);
  const all = readReservations_(true);
  const inspections = readInspections_();
  const settings = readSettings_();
  const closed = readClosed_();
  const today = today_();

  const day = all.filter(function (r) { return r.date === date; })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; })
    .map(function (r) { return publicRes_(r, true); });
  const week = dates.map(function (d) {
    const active = all.filter(function (r) { return r.date === d && r.status === '예약'; });
    return { date: d, count: active.length, people: people_(active), inspected: !!inspections[d], closed: !!closed[d] };
  });
  const bans = readBans_().map(function (b) {
    const live = b.status === '적용' && (b.kind === '무기한' || b.end >= today);
    return { id: b.id, studentId: b.studentId, name: b.name, kind: b.kind, start: b.start, end: b.end, days: b.days, reason: b.reason, createdAt: b.createdAt, status: live ? '적용' : (b.status === '해제' ? '해제' : '만료'), liftedAt: b.liftedAt };
  });
  return {
    ok: true, restCapacity: settings.restCapacity, notices: settings.notices,
    day: { date: date, reservations: day, inspection: inspections[date] || null, closed: closed[date] || null }, week: week,
    bans: bans.filter(function (b) { return b.status === '적용'; }),
    banHistory: bans.filter(function (b) { return b.status !== '적용'; }).reverse().slice(0, 20)
  };
}

function handleAdminCancel_(p) {
  checkPassword_(p.password);
  const reason = String(p.reason || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!reason) throw new Error('취소 사유를 입력하세요. 학생이 [내 예약 확인]에서 이 사유를 보게 됩니다.');
  return withLock_(function () {
    const r = findReservation_(p.key);
    if (!r || r.status !== '예약') throw new Error('이미 취소되었거나 없는 예약입니다.');
    setStatus_(r.row, '관리자 취소', reason);
    return { ok: true };
  });
}

/* ---------- 관리자: 휴관 (체육관 임시로 닫기) ---------- */
function handleSetClosed_(p) {
  checkPassword_(p.password);
  const date = String(p.date || '');
  checkDate_(date);
  if (date < today_()) throw new Error('지난 날짜는 바꿀 수 없습니다.');
  const memo = String(p.memo || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return withLock_(function () {
    const sh = sheet_(CONFIG.SHEET_CLOSED, HEADERS.closed);
    const rows = readClosedRows_();
    const cur = rows.filter(function (x) { return x.date === date && x.status === '적용'; })[0];
    if (!p.closed) {
      if (!cur) throw new Error('이 날은 이미 열려 있습니다.');
      sh.getRange(cur.row, 4, 1, 2).setNumberFormat('@').setValues([['해제', stamp_()]]);
      return { ok: true, closed: false };
    }
    if (cur) throw new Error('이 날은 이미 닫혀 있습니다.');
    appendText_(sh, [date, safe_(memo), stamp_(), '적용', '']);
    // 이미 들어온 예약은 모두 취소
    const reason = memo ? CLOSED_REASON + ' (' + memo + ')' : CLOSED_REASON;
    let canceled = 0;
    readReservations_(false).forEach(function (r) {
      if (r.date === date && r.status === '예약') { setStatus_(r.row, '관리자 취소', reason); canceled++; }
    });
    return { ok: true, closed: true, canceled: canceled };
  });
}

function readClosedRows_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_CLOSED);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.closed.length).getValues().map(function (v, i) {
    return { row: i + 2, date: cellDate_(v[0]), memo: cellText_(v[1]), createdAt: cellStamp_(v[2]), status: cellText_(v[3]) || '적용' };
  }).filter(function (x) { return x.date; });
}
// { 'yyyy-MM-dd': { memo, createdAt } } — 현재 닫혀 있는 날짜만
function readClosed_() {
  const out = {};
  readClosedRows_().forEach(function (x) { if (x.status === '적용') out[x.date] = { memo: x.memo, createdAt: x.createdAt }; });
  return out;
}

function handleInspection_(p) {
  checkPassword_(p.password);
  const date = String(p.date || '');
  checkDate_(date);
  if (date > today_()) throw new Error('이용일이 지난 뒤에 점검을 기록할 수 있습니다.');
  const inspector = String(p.inspector || '').trim().slice(0, 20);
  if (!inspector) throw new Error('점검자 이름을 입력하세요.');
  const items = p.items || {};
  const vals = INSPECT_ITEMS.map(function (it) {
    const v = items[it.key];
    if (v !== it.good && v !== it.bad) throw new Error('모든 점검 항목을 선택하세요.');
    return v;
  });
  const isBad = vals.map(function (v, i) { return v === INSPECT_ITEMS[i].bad; });
  const bad = isBad.filter(Boolean).length;
  const summary = bad ? '문제 ' + bad + '건' : '문제 없음';
  const memo = String(p.memo || '').trim().slice(0, 1000);
  if (bad && !memo) throw new Error('문제가 있는 항목이 있으면 특이사항에 내용을 적어 주세요.');
  const row = [date, stamp_(), safe_(inspector)].concat(vals, [summary, safe_(memo)]);

  withLock_(function () {
    const sh = sheet_(CONFIG.SHEET_INSPECTION, HEADERS.inspection);
    let target = 0;
    if (sh.getLastRow() > 1) {
      const dates = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < dates.length; i++) if (cellDate_(dates[i][0]) === date) { target = i + 2; break; }
    }
    if (target) writeText_(sh, target, row);
    else target = appendText_(sh, row);
    const colors = isBad.concat([bad > 0]).map(function (b) { return b ? '#FFEEEE' : '#E6F8EF'; });
    sh.getRange(target, 4, 1, colors.length).setBackgrounds([colors]);
  });
  return { ok: true };
}

function handleSaveSettings_(p) {
  checkPassword_(p.password);
  const cap = Math.round(Number(p.restCapacity));
  if (!(cap >= 0 && cap <= 300)) throw new Error('휴식 최대 인원은 0~300명 사이로 입력하세요.');
  const notices = normNotices_(p.notices);
  withLock_(function () { writeSettings_(notices, cap); });
  return { ok: true, settings: { notices: notices, restCapacity: cap } };
}

/* ---------- 관리자: 이용 제한 ---------- */
function handleAddBan_(p) {
  checkPassword_(p.password);
  const sid = String(p.studentId || '').trim(), name = String(p.name || '').trim().slice(0, 20);
  if (!/^\d{5}$/.test(sid)) throw new Error('학번을 5자리 숫자로 입력하세요.');
  if (!name) throw new Error('이름을 입력하세요.');
  const kind = p.kind === '무기한' ? '무기한' : '기간';
  const days = kind === '기간' ? Math.round(Number(p.days)) : '';
  if (kind === '기간' && !(days >= 1 && days <= 60)) throw new Error('정지 일수는 1~60일 사이로 입력하세요.');
  const start = nextSchoolDay_(today_());
  const end = kind === '기간' ? addSchoolDays_(start, days - 1) : '';
  const reason = String(p.reason || '').trim().slice(0, 200);

  return withLock_(function () {
    if (activeBanFor_(readBans_(), sid, start)) throw new Error(sid + ' ' + name + ' 학생은 이미 이용 제한 중입니다. 기존 제한을 해제한 뒤 다시 등록하세요.');
    const id = 'B' + Utilities.getUuid().replace(/-/g, '').slice(0, 5).toUpperCase();
    appendText_(sheet_(CONFIG.SHEET_BAN, HEADERS.ban), [id, sid, safe_(name), kind, start, end, days, safe_(reason), stamp_(), '적용', '']);

    // 제한 기간에 걸린 기존 예약 자동 취소 (단체 예약이면 그 예약 전체)
    let canceled = 0;
    readReservations_(false).forEach(function (r) {
      if (r.status !== '예약' || r.date < start || (end && r.date > end)) return;
      if (!r.members.some(function (m) { return m.id === sid; })) return;
      setStatus_(r.row, '이용 제한 취소', '체육관 이용이 제한된 학생이 포함되어 취소되었습니다.');
      canceled++;
    });
    return { ok: true, banId: id, start: start, end: end, canceled: canceled };
  });
}

function handleLiftBan_(p) {
  checkPassword_(p.password);
  return withLock_(function () {
    const b = readBans_().filter(function (x) { return x.id === String(p.banId || ''); })[0];
    if (!b || b.status !== '적용') throw new Error('이미 해제되었거나 없는 제한입니다.');
    sheet_(CONFIG.SHEET_BAN, HEADERS.ban).getRange(b.row, BC.STATUS + 1, 1, 2).setNumberFormat('@').setValues([['해제', stamp_()]]);
    return { ok: true };
  });
}

function readBans_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_BAN);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.ban.length).getValues().map(function (v, i) {
    return {
      row: i + 2, id: cellText_(v[BC.ID]), studentId: cellText_(v[BC.SID]), name: cellText_(v[BC.NAME]),
      kind: cellText_(v[BC.KIND]) === '무기한' ? '무기한' : '기간', start: cellDate_(v[BC.START]), end: cellDate_(v[BC.END]),
      days: Number(cellText_(v[BC.DAYS])) || 0, reason: cellText_(v[BC.REASON]), createdAt: cellStamp_(v[BC.CREATED]),
      status: cellText_(v[BC.STATUS]) || '적용', liftedAt: cellStamp_(v[BC.LIFTED])
    };
  }).filter(function (b) { return b.id && b.studentId; });
}

function activeBanFor_(bans, sid, date) {
  return bans.filter(function (b) {
    return b.status === '적용' && b.studentId === sid && (b.kind === '무기한' || (b.start <= date && date <= b.end));
  })[0] || null;
}

function banMessage_(b) {
  if (b.kind === '무기한') return '점심시간에 체육관을 이용할 수 없는 학생이에요';
  return b.days + '일간 체육관을 이용할 수 없는 학생이에요 (' + fmtKo_(b.end) + '까지)';
}

/* ---------- 시트 읽기·쓰기 ---------- */
// '함께하는 학생' 열: "30102 김철수, 30103 이영희"
function othersText_(members) {
  return members.slice(1).map(function (m) { return m.id + ' ' + m.name; }).join(', ');
}
function parseOthers_(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
    const i = x.indexOf(' ');
    return i < 0 ? { id: x, name: '' } : { id: x.slice(0, i), name: x.slice(i + 1).trim() };
  }).filter(function (m) { return /^\d{5}$/.test(m.id); });
}

function readReservations_(withPhoto) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_RESERVE);
  if (!sh || sh.getLastRow() < 2) return [];
  const width = withPhoto ? HEADERS.reserve.length : RC.REASON + 1;
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
  const out = [];
  values.forEach(function (v, i) {
    const code = normCode_(cellText_(v[RC.CODE]));
    const date = cellDate_(v[RC.DATE]);
    const repId = cellText_(v[RC.REP_ID]);
    if (!code || !date || !repId) return;
    const members = [{ id: repId, name: cellText_(v[RC.REP_NAME]) }].concat(parseOthers_(cellText_(v[RC.OTHERS])));
    const r = {
      row: i + 2, key: date + '#' + code, code: code, date: date, createdAt: cellStamp_(v[RC.CREATED]), place: cellText_(v[RC.PLACE]),
      type: cellText_(v[RC.TYPE]), members: members, status: cellText_(v[RC.STATUS]) || '예약', updatedAt: cellStamp_(v[RC.UPDATED]),
      reason: cellText_(v[RC.REASON])
    };
    if (withPhoto) { r.photoUrl = cellText_(v[RC.PHOTO]); r.thumb = cellText_(v[RC.THUMB]); }
    out.push(r);
  });
  return out;
}

function publicRes_(r, withPhoto) {
  const o = { key: r.key, code: r.code, createdAt: r.createdAt, date: r.date, place: r.place, type: r.type, members: r.members, status: r.status, updatedAt: r.updatedAt, reason: r.reason || '' };
  if (withPhoto) { o.photoUrl = r.photoUrl || ''; o.thumb = r.thumb || ''; }
  return o;
}

// key = "이용일#예약번호" — 같은 번호가 여러 줄이면 '예약' 상태를 우선
function findReservation_(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  const list = readReservations_(false).filter(function (r) { return r.key === k; });
  return list.filter(function (r) { return r.status === '예약'; })[0] || list[0] || null;
}

function setStatus_(row, status, reason) {
  const sh = sheet_(CONFIG.SHEET_RESERVE, HEADERS.reserve);
  sh.getRange(row, RC.STATUS + 1, 1, 3).setNumberFormat('@').setValues([[status, stamp_(), safe_(reason || '')]]);
  if (status !== '예약') sh.getRange(row, 1, 1, RC.REASON + 1).setFontColor('#9AA1AA');
}

function readInspections_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_INSPECTION);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.inspection.length).getValues().forEach(function (v) {
    const d = cellDate_(v[0]);
    if (!d) return;
    const items = {};
    INSPECT_ITEMS.forEach(function (it, i) { items[it.key] = cellText_(v[3 + i]); });
    out[d] = { inspector: cellText_(v[2]), items: items, memo: cellText_(v[8]), savedAt: cellStamp_(v[1]) };
  });
  return out;
}

function readSettings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_SETTINGS);
  if (!sh || sh.getLastRow() < 2) return { notices: normNotices_(DEFAULT_NOTICES), restCapacity: CONFIG.DEFAULT_REST_CAPACITY };
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  const notices = [];
  let restCapacity = CONFIG.DEFAULT_REST_CAPACITY;
  rows.forEach(function (r) {
    const type = cellText_(r[0]), text = cellText_(r[1]), size = cellText_(r[2]);
    if (type === '휴식정원') { const n = Math.round(Number(text)); if (n >= 0) restCapacity = n; return; }
    if (type === '정원') return; // 이전 버전 설정은 무시
    if (text && (type === '공지' || type === '')) notices.push({ size: (size === '긴 바' || size === 'long') ? 'long' : 'short', text: text });
  });
  return { notices: normNotices_(notices), restCapacity: restCapacity };
}

function writeSettings_(notices, restCapacity) {
  const sh = sheet_(CONFIG.SHEET_SETTINGS, HEADERS.settings);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 3)).clearContent();
  const rows = [['휴식정원', String(restCapacity), '휴식 최대 인원']]
    .concat(notices.map(function (n) { return ['공지', safe_(n.text), SIZE_LABEL[n.size]]; }));
  sh.getRange(2, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
  sh.getRange(2, 2, rows.length, 1).setWrap(true);
}

function normNotices_(list) {
  return (Array.isArray(list) ? list : []).map(function (n) {
    const obj = (typeof n === 'string') ? { size: 'short', text: n } : (n || {});
    const size = obj.size === 'long' ? 'long' : 'short';
    let text = String(obj.text || '').trim();
    if (size === 'short') text = text.replace(/\s*\n\s*/g, ' ');
    return { size: size, text: text.slice(0, NOTICE_MAX[size]) };
  }).filter(function (n) { return n.text; }).slice(0, 10);
}

/* ---------- 날짜 ---------- */
function today_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd'); }
function stamp_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm'); }
function utc_(s) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function addDays_(s, n) { const d = utc_(s); d.setUTCDate(d.getUTCDate() + n); return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd'); }
function isWeekend_(s) { const w = utc_(s).getUTCDay(); return w === 0 || w === 6; }
function nextSchoolDay_(s) { let d = addDays_(s, 1); while (isWeekend_(d)) d = addDays_(d, 1); return d; }
function addSchoolDays_(start, n) { let d = start; for (let i = 0; i < n; i++) d = nextSchoolDay_(d); return d; }
function fmtKo_(s) { const d = utc_(s); return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 (' + '일월화수목금토'.charAt(d.getUTCDay()) + ')'; }

// 셀 값을 문자열로 통일 (시트가 날짜·숫자로 자동 변환해도 안전하게)
function cellText_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function cellDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return cellText_(v).slice(0, 10);
}
function cellStamp_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');
  return cellText_(v);
}

/* ---------- 유틸 ---------- */
function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#F2F4F6');
    sh.setFrozenRows(1);
  }
  return sh;
}

// 모든 값을 '텍스트 서식'으로 기록 → 날짜·학번·예약번호(01)가 숫자로 바뀌지 않음
function appendText_(sh, row) {
  const r = sh.getLastRow() + 1;
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  writeText_(sh, r, row);
  return r;
}
function writeText_(sh, r, row) {
  sh.getRange(r, 1, 1, row.length)
    .setNumberFormat('@')
    .setValues([row.map(function (v) { return v === null || v === undefined ? '' : String(v); })]);
}

function people_(list) { return list.reduce(function (n, r) { return n + r.members.length; }, 0); }

function checkDate_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
}

// 비밀번호는 [프로젝트 설정 > 스크립트 속성]의 ADMIN_PASSWORD (코드·GitHub에는 없음)
function adminPassword_() {
  return String(PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || '').trim();
}

function checkPassword_(input) {
  const pw = adminPassword_();
  if (!pw) throw new Error('관리자 비밀번호가 설정되지 않았습니다. Apps Script [프로젝트 설정 > 스크립트 속성]에 ADMIN_PASSWORD 를 추가하세요.');
  if (String(input || '') !== pw) {
    Utilities.sleep(1000); // 비밀번호를 마구 넣어 보는 것을 느리게
    throw new Error('비밀번호가 올바르지 않습니다.');
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// 학생이 '=' 등으로 시작하는 값을 넣어 수식이 실행되는 것을 막음 (읽을 때는 앞의 ' 가 자동으로 빠짐)
function safe_(v) { return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v; }

function errMsg_(err) { return (err && err.message) ? err.message : String(err); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
