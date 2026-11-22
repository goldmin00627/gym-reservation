const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = ['Code.gs'].map(name => fs.readFileSync(path.join(__dirname, '../apps-script', name), 'utf8')).join('\n');
const documents = new Map();
let version = 0;
let uploads = 0;
let uuidSequence = 0;
let rejectCommit = false;
const props = new Map([['ADMIN_PASSWORD', 'test-only-secret']]);
const clone = value => JSON.parse(JSON.stringify(value));
let clockNow = '2026-11-19T08:00:00Z';
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [clockNow])); }
}
function context() {
  const c = vm.createContext({
    Date: Clock, console,
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => props.get(k), setProperty: (k,v) => props.set(k,v)})},
    ScriptApp: {getOAuthToken: () => 'fake-token'},
    DriveApp: {
      getFolderById(id) {
        assert.equal(id, '1p_ZujlcdwI_xyzIU75RxX74HXuqpfsS6');
        return {createFile() {uploads++; return {getId: () => 'photo-' + uploads, getUrl: () => 'https://drive.google.com/file/d/photo-' + uploads};}};
      },
      getFileById: () => ({setTrashed() {uploads--;}})
    },
    Utilities: {
      sleep() {}, getUuid: () => String(++uuidSequence).padStart(5, '0') + '000-0123-4567-89ab-012345678901',
      base64Decode: s => Array.from(Buffer.from(s, 'base64')), newBlob: bytes => bytes,
      formatDate(d, timezone, pattern) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
        }).formatToParts(d).map(p => [p.type,p.value]));
        return pattern.replace('yyyy',parts.year).replace('MM',parts.month).replace('dd',parts.day).replace('HH',parts.hour).replace('H',String(Number(parts.hour))).replace('mm',parts.minute).replace('ss',parts.second);
      }
    },
    UrlFetchApp: {fetch(url, options) {
      const name = decodeURIComponent(url.split('/v1/')[1].split('?')[0]);
      const reply = (status, body) => ({getResponseCode: () => status, getContentText: () => JSON.stringify(body)});
      if (options.method === 'post') {
        const writes = JSON.parse(options.payload).writes;
        const revision = writes.at(-1), current = documents.get(revision.update.name);
        if (rejectCommit || (revision.currentDocument.exists === false ? !!current : current?.updateTime !== revision.currentDocument.updateTime)) return reply(412, {});
        // Validate all preconditions before mutating any document.
        const updateTime = String(++version);
        writes.forEach(w => documents.set(w.update.name, {...clone(w.update),updateTime}));
        return reply(200, {});
      }
      if (name.endsWith('/internal/revision')) return reply(documents.has(name) ? 200 : 404, documents.get(name) || {});
      return reply(200, {documents:Array.from(documents.values()).filter(d => d.name.startsWith(name + '/') && !d.name.slice(name.length+1).includes('/'))});
    }}
  });
  vm.runInContext(source,c);
  return c;
}
const a = context(), b = context();
const request = {action:'reserve',date:'2026-11-20',place:'코트 1',type:'개인',members:[{id:'30101',name:'테스트'}],photo:'data:image/jpeg;base64,/9j/2Q==',thumb:'data:image/jpeg;base64,/9j/2Q==',agreePrivacy:true,agreePenalty:true};
assert.equal(a.route_({action:'login',password:'test-only-secret'}).ok,true);
assert.equal(a.route_({action:'login',password:'1234'}).ok,false);
assert.equal(a.route_({action:'__proto__'}).ok,false);
const first = a.route_(request);
assert.equal(first.ok,true,first.error);
assert.equal(uploads,1);
// A second server instance reads the same reservation.
const publicView = b.route_({action:'public'});
assert.equal(publicView.days.find(d=>d.date==='2026-11-20').occupancy['코트 1'].people,1);
assert.equal(a.route_(request).ok,false);
assert.equal(uploads,1,'duplicate must fail before uploading');
for (let i=2;i<=4;i++) {
 const result = a.route_({...request,members:[{id:'3010'+i,name:'테스트'+i}]});
 assert.equal(result.ok,true,result.error);
}
assert.equal(a.route_({...request,members:[{id:'30105',name:'정원초과'}]}).ok,false);
assert.equal(uploads,4);
const holiday = a.route_({...request,date:'2026-12-25'});
assert.equal(holiday.ok,false); assert.match(holiday.error,/성탄절/);
assert.equal(a.route_({action:'saveSettings',password:'bad',restCapacity:10,notices:[]}).ok,false);
assert.equal(a.route_({action:'saveSettings',password:'test-only-secret',restCapacity:10,notices:[{size:'long',text:'공유 공지'}]}).ok,true);
assert.equal(b.route_({action:'public'}).notices[0].text,'공유 공지');
assert.equal(a.route_({action:'inspection',password:'test-only-secret',date:'2026-11-18',inspector:'교사',items:{equipment:'양호',cleanliness:'양호',safety:'없음',other:'없음'},memo:''}).ok,true);
assert.equal(b.route_({action:'admin',password:'test-only-secret',date:'2026-11-18',dates:[]}).day.inspection.inspector,'교사');
assert.equal(b.route_({action:'admin',password:'bad',date:'2026-11-20'}).ok,false);
assert.equal(b.route_({action:'lookup',studentId:'30101',name:'테스트',code:first.reservation.code}).reservations.length,1);
const before = clone(Array.from(documents));
rejectCommit = true;
assert.equal(a.route_({action:'saveSettings',password:'test-only-secret',restCapacity:0,notices:[]}).ok,false);
assert.deepEqual(Array.from(documents),before,'failed commit must leave all documents unchanged');
rejectCommit = false;
// Two independent deployments cannot overwrite a concurrent committed change.
a.beginStore_(); b.beginStore_();
a.patchRow_('설정',2,1,['11']); b.patchRow_('설정',2,1,['12']);
a.commitStore_(); assert.throws(()=>b.commitStore_(),/다른 요청/);
console.log('PASS shared reservations, notices, inspections, private admin, holiday, capacity, duplicate, atomic rollback and concurrent revision checks');

const high = a.route_({...request,place:'휴식',members:[{school:'고',id:'30101',name:'테스트'}]});
assert.equal(high.ok,true,high.error);
assert.equal(high.reservation.members[0].school,'고');
const highQuery = {action:'lookup',school:'고',studentId:'30101',name:'테스트',code:high.reservation.code};
assert.equal(b.route_(highQuery).reservations[0].members[0].school,'고');
assert.equal(b.route_({...highQuery,school:'중'}).ok,false);
assert.equal(a.route_({...request,place:'휴식',members:[{school:'고',id:'30101',name:'테스트'}]}).ok,false);
const mixed = a.route_({...request,place:'휴식',type:'단체',members:[{school:'중',id:'30201',name:'중학생'},{school:'고',id:'30201',name:'고등학생'}]});
assert.equal(mixed.ok,true,mixed.error);
const storedMixed=b.route_({action:'admin',password:'test-only-secret',date:request.date,dates:[]}).day.reservations.find(r=>r.key===mixed.reservation.key);
assert.equal(storedMixed.members[0].school,'중'); assert.equal(storedMixed.members[1].school,'고');
assert.equal(a.route_({...request,members:[{school:'대',id:'30301',name:'잘못된 학교급'}]}).ok,false);
const ban=a.route_({action:'addBan',password:'test-only-secret',school:'고',studentId:'30101',name:'테스트',kind:'기간',days:1,reason:'테스트'});
assert.equal(ban.ok,true,ban.error);
assert.equal(b.route_({action:'checkBan',studentId:'30101',school:'고',date:request.date}).banned,true);
assert.equal(b.route_({action:'checkBan',studentId:'30101',school:'중',date:request.date}).banned,false);
assert.equal(b.route_({action:'admin',password:'test-only-secret',date:request.date,dates:[]}).day.reservations.find(r=>r.key===first.reservation.key).status,'예약');
console.log('PASS middle/high identity separation, mixed groups, persisted school, school-specific lookup and bans');

props.delete('ADMIN_LOGIN_STATE');
assert.match(a.route_({action:'login',password:'bad'}).error,/\[1\/3\]/);
assert.match(b.route_({action:'login',password:'bad'}).error,/\[2\/3\]/);
assert.match(a.route_({action:'login',password:'bad'}).error,/\[3\/3\]/);
const locked = props.get('ADMIN_LOGIN_STATE');
assert.equal(b.route_({action:'login',password:'test-only-secret'}).ok,false);
assert.equal(b.route_({action:'admin',password:'test-only-secret',date:request.date,dates:[]}).ok,false);
assert.equal(b.route_({action:'saveSettings',password:'test-only-secret',restCapacity:0,notices:[]}).ok,false);
assert.equal(b.route_({action:'public'}).ok,true);
assert.equal(props.get('ADMIN_LOGIN_STATE'),locked,'blocked requests must not extend lock');
clockNow = '2026-11-19T08:09:59.999Z';
assert.equal(a.route_({action:'login',password:'test-only-secret'}).ok,false);
clockNow = '2026-11-19T08:10:00Z';
assert.equal(a.route_({action:'login',password:'test-only-secret'}).ok,true);
assert.equal(JSON.parse(props.get('ADMIN_LOGIN_STATE')).failures,0);
assert.equal(a.route_({action:'login',password:'bad'}).ok,false);
assert.equal(a.route_({action:'login',password:'test-only-secret'}).ok,true);
assert.match(b.route_({action:'login',password:'bad'}).error,/\[1\/3\]/);
console.log('PASS three failures lock every admin endpoint across clients, student access, no lock extension, exact expiry and success reset');

// Every overlapping pair is checked in both directions, including a single badminton student.
for (const [half, courts] of [['농구 왼쪽 반코트',['코트 1','코트 3']],['농구 오른쪽 반코트',['코트 2','코트 4']]]) {
  for (const court of courts) {
    const other = courts.includes('코트 1') ? '코트 2' : '코트 1';
    const checks = vm.runInContext(`(() => {
      let occ=occupancy_([{place:${JSON.stringify(court)},type:'개인',members:[{}]}]);
      const forward=placeError_(${JSON.stringify(half)},'개인',1,occ,30);
      occ=occupancy_([{place:${JSON.stringify(half)},type:'개인',members:[{}]}]);
      return [forward,placeError_(${JSON.stringify(court)},'개인',1,occ,30),placeError_(${JSON.stringify(other)},'개인',1,occ,30),placeError_('코트 5','단체',4,occ,30),placeError_('배구','단체',10,occ,30)];
    })()`,a);
    assert.match(checks[0],/겹쳐/); assert.match(checks[1],/겹쳐/); assert.equal(checks[2],''); assert.equal(checks[3],''); assert.match(checks[4],/먼저/);
  }
}
props.delete('ADMIN_LOGIN_STATE');
const login1=a.route_({action:'login',password:'bad'});
assert.equal(login1.failures,1); assert.equal(login1.code,'ADMIN_LOGIN'); assert.equal(login1.lockedUntil,0);
b.route_({action:'login',password:'bad'});
const login3=a.route_({action:'login',password:'bad'});
assert.equal(login3.failures,3); assert.equal(login3.lockedUntil-login3.serverNow,600000);
props.delete('ADMIN_LOGIN_STATE');
// Full request route rejects a conflicting half before uploading a photo, across server instances.
const uploadsBeforeHalf=uploads;
const blockedHalf=b.route_({...request,place:'농구 왼쪽 반코트',type:'단체',members:Array.from({length:4},(_,i)=>({school:'중',id:String(30990+i),name:'충돌검증'+i}))});
assert.equal(blockedHalf.ok,false); assert.match(blockedHalf.error,/겹쳐/); assert.equal(uploads,uploadsBeforeHalf);
assert.equal(b.route_({action:'public'}).courtLayouts,true);
console.log('PASS both basketball halves conflict with both badminton courts, opposite half/small gym stay available, volleyball exclusion, safe error metadata and full-route collision rejection');

// Basketball boundaries apply to both booking and member updates via the shared validator.
for (const half of ['농구 왼쪽 반코트','농구 오른쪽 반코트']) {
  for (const n of [3,4,8,9]) {
    const members=Array.from({length:n},(_,i)=>({school:'중',id:String(31000+i),name:'농구'+i}));
    a.basketTest={half,members};
    if(n===4||n===8) assert.equal(vm.runInContext("validateMembers_('단체',basketTest.members,basketTest.half).length",a),n);
    else assert.throws(()=>vm.runInContext("validateMembers_('단체',basketTest.members,basketTest.half)",a),/4~8명/);
  }
  assert.throws(()=>a.validateMembers_('개인',[{school:'중',id:'31000',name:'개인'}],half),/4~8명/);
}
const basketballTeam=Array.from({length:8},(_,i)=>({school:'중',id:String(32000+i),name:'농구팀'+i}));
const basketball=a.route_({...request,place:'농구 오른쪽 반코트',type:'단체',members:basketballTeam});
assert.equal(basketball.ok,true,basketball.error);
assert.equal(basketball.reservation.members.length,8);
const changes={action:'updateMembers',school:'중',studentId:'32000',name:'농구팀0',code:basketball.reservation.code,key:basketball.reservation.key};
assert.equal(a.route_({...changes,members:basketballTeam.slice(0,3)}).ok,false);
assert.equal(a.route_({...changes,members:basketballTeam.slice(0,4)}).ok,true);
assert.equal(b.route_({...request,place:'코트 2',members:[{id:'32111',name:'배드민턴'}]}).ok,false);
console.log('PASS basketball 3/4/8/9 boundaries, no individual booking, eight-person persisted booking and member edit minimum');

props.delete('ADMIN_LOGIN_STATE');
const adminAudit=(action,extra={})=>a.route_({action,password:'test-only-secret',...extra});
const dayAudit=()=>adminAudit('admin',{date:request.date,dates:[request.date]}).day;
const firstCred={school:'중',studentId:'30101',name:'테스트',code:first.reservation.code,key:first.reservation.key};
assert.equal(a.route_({action:'cancel',...firstCred,name:'다른이름'}).ok,false);
assert.equal(a.route_({action:'cancel',...firstCred}).ok,true);
assert.equal(b.route_({action:'lookup',...firstCred}).reservations.find(r=>r.key===first.reservation.key).status,'취소');
assert.equal(a.route_({action:'cancel',...firstCred}).ok,false);
const adminTarget=dayAudit().reservations.find(r=>r.status==='예약' && r.place==='코트 1');
assert.equal(adminAudit('adminCancel',{key:adminTarget.key,reason:''}).ok,false);
assert.equal(adminAudit('adminCancel',{key:adminTarget.key,reason:'운영 점검'}).ok,true);
assert.equal(dayAudit().reservations.find(r=>r.key===adminTarget.key).reason,'운영 점검');
const beforeBan=dayAudit().reservations.find(r=>r.key===mixed.reservation.key);
assert.equal(beforeBan.status,'예약');
const auditBan=adminAudit('addBan',{school:'중',studentId:'30201',name:'중학생',kind:'기간',days:1,reason:'점검용'});
assert.equal(auditBan.ok,true,auditBan.error);
assert.equal(dayAudit().reservations.find(r=>r.key===mixed.reservation.key).status,'이용 제한 취소');
assert.equal(adminAudit('liftBan',{banId:auditBan.banId}).ok,true);
assert.equal(a.route_({action:'checkBan',studentId:'30201',school:'중',date:request.date}).banned,false);
const close=adminAudit('setClosed',{date:request.date,closed:true,memo:'시설점검'});
assert.equal(close.ok,true,close.error);
assert.equal(dayAudit().reservations.filter(r=>r.status==='예약').length,0);
assert.equal(b.route_({...request,members:[{id:'33001',name:'휴관검증'}]}).ok,false);
assert.equal(adminAudit('setClosed',{date:request.date,closed:false}).ok,true);
assert.equal(dayAudit().reservations.filter(r=>r.status==='예약').length,0,'reopening must not restore canceled bookings');
let studentSerial=34000;
const groupAudit=n=>Array.from({length:n},()=>({school:'중',id:String(++studentSerial),name:'가상검증'}));
const small= a.route_({...request,place:'코트 5',type:'단체',members:groupAudit(4)});
assert.equal(small.ok,true,small.error);
const volley=a.route_({...request,place:'배구',type:'단체',members:groupAudit(10)});
assert.equal(volley.ok,true,volley.error);
assert.equal(a.route_({...request,place:'코트 1',members:groupAudit(1)}).ok,false);
assert.equal(a.route_({...request,place:'농구 왼쪽 반코트',type:'단체',members:groupAudit(4)}).ok,false);
assert.equal(a.route_({...request,place:'배구',type:'단체',members:groupAudit(10)}).ok,false);
assert.equal(a.route_({...request,place:'배구',type:'단체',members:groupAudit(21)}).ok,false);
assert.equal(adminAudit('saveSettings',{restCapacity:10,notices:[]}).ok,true);
for(const n of [4,4,2]) assert.equal(a.route_({...request,place:'휴식',type:'단체',members:groupAudit(n)}).ok,true);
assert.equal(a.route_({...request,place:'휴식',members:groupAudit(1)}).ok,false);
assert.equal(adminAudit('inspection',{date:'2026-11-18',inspector:'검증',items:{equipment:'불량',cleanliness:'양호',safety:'없음',other:'없음'},memo:''}).ok,false);
assert.equal(adminAudit('inspection',{date:'2026-11-18',inspector:'검증',items:{equipment:'불량',cleanliness:'양호',safety:'없음',other:'없음'},memo:'용구 확인 필요'}).ok,true);
assert.equal(adminAudit('inspection',{date:'2026-11-20',inspector:'검증',items:{equipment:'양호',cleanliness:'양호',safety:'없음',other:'없음'},memo:''}).ok,false);
const jsonBefore=JSON.stringify(Array.from(documents));
assert.equal(adminAudit('saveSettings',{restCapacity:-1,notices:[]}).ok,false);
assert.equal(JSON.stringify(Array.from(documents)),jsonBefore);
assert.equal(a.route_({action:'not-a-real-action'}).ok,false);
clockNow='2026-11-22T07:59:59Z';
assert.equal(a.route_({action:'public'}).days[0].date,'2026-11-16');
clockNow='2026-11-22T08:00:00Z';
assert.equal(a.route_({action:'public'}).days[0].date,'2026-11-23');
clockNow='2026-12-20T08:00:00Z';
const christmas=a.route_({action:'public'}).days.find(d=>d.date==='2026-12-25');
assert.equal(christmas.closed,true);assert.match(christmas.closedMemo,/성탄절/);
assert.equal(a.route_({...request,date:'2026-12-25',members:groupAudit(1)}).ok,false);
console.log('PASS extended audit: student/admin cancellation, cancellation history, ban cancellation/lift, closure/reopen, small gym independence, volleyball exclusivity, rest capacity, inspection validation, settings validation and Sunday 17:00 holiday boundaries');
// Public reads must still work when a reservation owns the mutation lock.
const busy=context(); let waits=0,releases=0;
busy.LockService.getScriptLock=()=>({waitLock(){waits++;throw new Error('잠금 시간초과');},releaseLock(){releases++;}});
const beforePublic=JSON.stringify(Array.from(documents));
assert.equal(busy.route_({action:'public'}).ok,true);
assert.equal(waits,0);assert.equal(releases,0);
assert.equal(JSON.stringify(Array.from(documents)),beforePublic,'public cannot persist data');
assert.equal(busy.route_(request).ok,false);assert.equal(waits,1);assert.equal(releases,0,'never release a lock that was not acquired');
const authOnly=context();let fetches=0;
authOnly.UrlFetchApp.fetch=()=>{fetches++;throw new Error('Firestore temporarily offline');};
assert.equal(authOnly.route_({action:'login',password:'test-only-secret'}).ok,true);
assert.equal(fetches,0,'login requires only script properties and its lock');
console.log('PASS public reads bypass a held mutation lock without writes; reservations remain locked; login avoids Firestore; unacquired locks are not released');
