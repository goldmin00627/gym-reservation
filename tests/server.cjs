const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = ['Code.gs'].map(name => fs.readFileSync(path.join(__dirname, '../apps-script', name), 'utf8')).join('\n');
const documents = new Map();
let version = 0;
let uploads = 0;
let rejectCommit = false;
const props = new Map([['ADMIN_PASSWORD', '0108']]);
const clone = value => JSON.parse(JSON.stringify(value));
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-11-19T08:00:00Z'])); }
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
      sleep() {}, getUuid: () => 'abcdefgh-0123-4567-89ab-012345678901',
      base64Decode: s => Array.from(Buffer.from(s, 'base64')), newBlob: bytes => bytes,
      formatDate(d, timezone, pattern) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
        }).formatToParts(d).map(p => [p.type,p.value]));
        return pattern.replace('yyyy',parts.year).replace('MM',parts.month).replace('dd',parts.day).replace('HH',parts.hour).replace('mm',parts.minute).replace('ss',parts.second);
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
assert.equal(a.route_({action:'login',password:'0108'}).ok,true);
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
assert.equal(a.route_({action:'saveSettings',password:'0108',restCapacity:10,notices:[{size:'long',text:'공유 공지'}]}).ok,true);
assert.equal(b.route_({action:'public'}).notices[0].text,'공유 공지');
assert.equal(a.route_({action:'inspection',password:'0108',date:'2026-11-18',inspector:'교사',items:{equipment:'양호',cleanliness:'양호',safety:'없음',other:'없음'},memo:''}).ok,true);
assert.equal(b.route_({action:'admin',password:'0108',date:'2026-11-18',dates:[]}).day.inspection.inspector,'교사');
assert.equal(b.route_({action:'admin',password:'bad',date:'2026-11-20'}).ok,false);
assert.equal(b.route_({action:'lookup',studentId:'30101',name:'테스트',code:first.reservation.code}).reservations.length,1);
const before = clone(Array.from(documents));
rejectCommit = true;
assert.equal(a.route_({action:'saveSettings',password:'0108',restCapacity:0,notices:[]}).ok,false);
assert.deepEqual(Array.from(documents),before,'failed commit must leave all documents unchanged');
rejectCommit = false;
// Two independent deployments cannot overwrite a concurrent committed change.
a.beginStore_(); b.beginStore_();
a.patchRow_('설정',2,1,['11']); b.patchRow_('설정',2,1,['12']);
a.commitStore_(); assert.throws(()=>b.commitStore_(),/다른 요청/);
console.log('PASS shared reservations, notices, inspections, private admin, holiday, capacity, duplicate, atomic rollback and concurrent revision checks');
