// DOM integration tests; pass a jsdom installation through NODE_PATH.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const errors=[]; const vc=new VirtualConsole(); vc.on('jsdomError',error=>errors.push(error));
let now=Date.now();
function page(storage={}) {
  return new JSDOM(html,{url:'https://gym.test/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    w.tailwind={}; w.scrollTo=()=>{}; w.Date.now=()=>now;
    Object.entries(storage).forEach(([k,v])=>w.localStorage.setItem(k,v));
    w.setTimeout=(fn)=>0; w.clearTimeout=()=>{}; w.setInterval=()=>0;
  }});
}
(async()=>{
const dom=page(), w=dom.window, $=s=>w.document.querySelector(s);
await new Promise(resolve=>setTimeout(resolve,0));
assert.deepEqual(errors.map(e=>e.message),[],'all inline scripts initialize without browser errors');
assert.equal($('#schoolToggle'),null,'no duplicate toggle above the reservation form');
w.eval('lockSteps(false)');
const schoolSwitch = '[data-i="0"] [data-school-toggle]';
assert.ok($('#memberRows').contains($(schoolSwitch)));
assert.equal($(schoolSwitch).getAttribute('aria-checked'),'false');
$(schoolSwitch).click();
assert.equal($(schoolSwitch).getAttribute('aria-checked'),'true');
assert.equal(w.eval('blankMember().school'),'고');
assert.equal(w.eval('state.members[0].school'),'고');
assert.equal(w.eval('state.members[1].school'),'중','school changes affect only the selected student');
w.eval("state.type='group';renderMembers()");
$('[data-i="1"] [data-school-toggle]').click();
assert.equal(w.eval('state.members[1].school'),'고');
$(schoolSwitch).click();
assert.equal(w.eval('state.members[0].school'),'중');
assert.equal(w.eval('state.members[1].school'),'고');
assert.equal(w.document.activeElement,$(schoolSwitch),'keyboard focus survives rendering');
// Volleyball's fraction describes whether its one shared area is available, including conflicts.
for(const occupied of [null,'배구','코트 1','코트 2','코트 3','코트 4','농구 왼쪽 반코트','농구 오른쪽 반코트','코트 5']) {
  w.eval(`state.pub.bookable=true;state.pub.occupancy=emptyOcc();${occupied ? `state.pub.occupancy[${JSON.stringify(occupied)}].people=1;` : ''}renderPlaces()`);
  const blocked=occupied!==null && occupied!=='코트 5';
  const card=$('#placeMap [data-special-kind="volleyball"]');
  assert.match(card.textContent,blocked ? /불가\s*\(1\/1\)/ : /가능\s*\(0\/1\)/);
  assert.doesNotMatch(card.textContent,/선착순|일반 코트|대체육관 전체/);
  const desc=card.querySelector('.venue-description');
  assert.equal(desc.querySelectorAll('br').length,1);
  assert.equal(desc.innerHTML,'단체 10~20명 ·<br>눌러서 배구코트 선택');
}
assert.equal($('#placeMap [data-special-kind="basketball"] .venue-description').innerHTML,'단체 4~8명 ·<br>눌러서 농구코트 선택');

// Special venues open a draft-only popup; availability is checked again before confirmation.
w.eval(`state.pub.bookable=true;state.pub.date='2026-11-23';state.pub.occupancy=emptyOcc();state.pub.occupancy['코트 3'].people=1;renderPlaces();`);
const basketballButton='#placeMap [data-special-kind="basketball"]';
const volleyballButton='#placeMap [data-special-kind="volleyball"]';
assert.match($(basketballButton).textContent,/가능/);
assert.doesNotMatch($(basketballButton).textContent,/2\/2/);
const beforeMembers=w.eval('state.members.length');
$(basketballButton).click();
assert.equal($('#specialModal').classList.contains('hidden'),false);
assert.equal(w.eval('state.place'),null);
assert.equal(w.eval('state.members.length'),beforeMembers,'opening must not alter entered members');
assert.equal($('#specialConfirm').disabled,true);
assert.match($('#specialCards').textContent,/농구코트 1/);
assert.match($('#specialCards').textContent,/코트 2·4 구역/);
assert.equal($('[data-special-place="농구 왼쪽 반코트"]').disabled,true);
assert.equal($('[data-special-place="농구 오른쪽 반코트"]').disabled,false);
assert.equal($('#specialCards svg').getAttribute('viewBox'),'0 0 110 200');
assert.equal($('#specialCards svg g').getAttribute('transform'),'translate(0 200) rotate(-90)');
$('[data-special-place="농구 오른쪽 반코트"]').click();
assert.equal(w.eval('state.place'),null,'draft stays separate until confirmation');
$('#specialCancel').click();
assert.equal(w.eval('state.place'),null);
assert.equal(w.document.body.style.overflow,'');
assert.equal(w.document.activeElement,$(basketballButton));
$(basketballButton).click();
$('[data-special-place="농구 오른쪽 반코트"]').click();
assert.equal($('#specialConfirm').disabled,false);
$('#specialConfirm').click();
assert.equal(w.eval('state.type'),'group'); assert.equal(w.eval('state.members.length'),4);
assert.equal(w.eval('memberLimits().max'),8);
assert.equal(w.eval('state.place'),'농구 오른쪽 반코트');
assert.equal(w.eval('placeLabel(state.place)'),'농구코트 2 (코트 2·4 구역)');
assert.equal($('#specialModal').classList.contains('hidden'),true);
assert.match($('[data-place="코트 2"]').textContent,/농구로 사용/);
for(let i=0;i<4;i++) $('#btnAddMember').click();
assert.equal(w.eval('state.members.length'),8); assert.equal($('#btnAddMember').disabled,true);
assert.match($('#typeNote').textContent,/4~8명/);
// A newly occupied draft must be invalidated on a live availability refresh.
$(basketballButton).click();
w.eval("state.pub.occupancy['코트 2'].people=1;renderPlaces()");
assert.equal($('#specialConfirm').disabled,true);
assert.match($('#specialError').textContent,/선택 가능한 농구코트가 없습니다/);
assert.equal($('#specialCards').querySelectorAll('button:disabled').length,2);
$('#specialCancel').click();
w.eval('state.pub.occupancy=emptyOcc();renderPlaces()');
$('[data-place="코트 1"]').click();
assert.equal(w.eval('state.members.length'),4);
$(volleyballButton).click();
assert.equal($('#specialCards').children.length,1);
assert.match($('#specialTitle').textContent,/배구코트 선택/);
assert.match($('#specialSubtitle').textContent,/10~20명/);
assert.equal(w.eval('state.place'),'코트 1');
$('[data-special-place="배구"]').click();
$('#specialConfirm').click();
assert.equal(w.eval('state.place'),'배구');assert.equal(w.eval('state.members.length'),10);
assert.equal(w.eval('memberLimits().max'),20);
w.eval("state.pub.occupancy['코트 4'].people=1;renderPlaces()");
assert.match($(volleyballButton).textContent,/불가/);
$(volleyballButton).click();
assert.equal($('[data-special-place="배구"]').disabled,true);
assert.equal($('#specialConfirm').disabled,true);
assert.match($('#specialError').textContent,/현재 배구코트를 예약할 수 없습니다/);
$('#specialClose').focus();
$('#specialClose').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
assert.equal(w.document.activeElement,$('#specialCancel'));
$('#specialCancel').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
assert.equal($('#specialModal').classList.contains('hidden'),true);
// Admin cards remain compact, while their popups inspect availability without changing a booking.
w.eval(`state.view='admin';state.admin.date='2026-11-23';state.admin.data={restCapacity:30,day:{date:'2026-11-23',closed:null,reservations:[{place:'코트 1',status:'예약',type:'개인',members:[{id:'30101',name:'가상학생'}]}]}};el.adminMap.innerHTML=renderMap(occupancyOf(state.admin.data.day.reservations),{selectable:false,compact:true,inspectSpecial:true,restCap:30});`);
assert.doesNotMatch($('#adminMap').textContent,/단체 4~8명/);
$('#adminMap [data-special-kind="basketball"]').click();
assert.equal($('#specialConfirm').hidden,true);
assert.equal($('#specialCards [data-special-place]'),null);
assert.match($('#specialCards').textContent,/예약 불가/);
assert.match($('#specialCards').textContent,/예약 가능/);
assert.doesNotMatch($('#specialCards').textContent,/가상학생/);
$('#specialCancel').click();
w.eval("state.view='student';state.place=null;state.pub.occupancy=emptyOcc();renderPlaces()");
$(basketballButton).click();w.eval("state.pub.date='2026-11-24';refreshSpecial()");
assert.equal($('#specialModal').classList.contains('hidden'),true);
assert.equal(w.eval('limitsFor({place:BASKET[0]}).min'),4);
for(const n of [3,9]) assert.throws(()=>w.eval(`validateMembers('단체',Array.from({length:${n}},(_,i)=>({school:'중',id:String(31000+i),name:'농구'+i})),BASKET[0])`),/4~8명/);

assert.match(w.document.body.textContent,/학기 말 일괄 삭제됩니다/);
assert.match($('.site-footer').textContent,/Copyright © 2026 김민석/);
for(let n=1;n<=3;n++){
  w.eval(`try{demoCheckPw({password:'wrong'})}catch{};openPw();`);
  assert.match($('#pwError').textContent,new RegExp('\\['+n+'/3\\]'));
}
assert.equal($('#pwInput').disabled,true); assert.equal($('#pwTimer').textContent,'10:00');
now+=1000; w.eval('paintLogin()'); assert.equal($('#pwTimer').textContent,'09:59');
const saved={}; for(let i=0;i<w.localStorage.length;i++){const key=w.localStorage.key(i);saved[key]=w.localStorage.getItem(key);}
const reloaded=page(saved); await new Promise(resolve=>setTimeout(resolve,0));
reloaded.window.eval('openPw()');
assert.equal(reloaded.window.document.querySelector('#pwTimer').textContent,'09:59');
assert.equal(reloaded.window.document.querySelector('#pwInput').disabled,true);
now+=599000; w.eval('paintLogin()');assert.equal($('#pwInput').disabled,false); assert.equal($('#pwTimer').textContent,'');
// Render active students only; arbitrary student text is escaped and photos never enter the screen DOM.
w.eval(`state.view='admin';state.admin.date='2026-11-20';state.admin.data={day:{date:'2026-11-20',reservations:[{status:'예약',place:'코트 1',members:[{school:'고',id:'30101',name:'<img src=x onerror=alert(1)>'}],thumb:'data:image/jpeg;base64,secret'},{status:'취소',place:'코트 2',members:[{school:'중',id:'30202',name:'취소학생'}]}]}};el.screenBoard.classList.remove('hidden');renderScreen();`);
assert.equal($('#screenBoard img'),null); assert.match($('#screenCards').textContent,/고 30101/);assert.doesNotMatch($('#screenCards').textContent,/취소학생/);assert.doesNotMatch($('#screenCards').innerHTML,/base64/);
// Physical positions, merging, empty states and totals reflect only active member counts.
const booking=(place,n,extra={})=>({place,status:'예약',type:n>1?'단체':'개인',members:Array.from({length:n},(_,i)=>({school:'중',id:String(31001+i),name:'가상학생'+i})),...extra});
const board=(records,closed=null)=>{
 w.eval(`state.admin.data={restCapacity:30,day:{date:'2026-11-23',closed:${JSON.stringify(closed)},reservations:${JSON.stringify(records)}}};renderScreen()`);
};
board([]);
assert.equal($('#screenCards').querySelectorAll('[data-screen-place]').length,5);
assert.equal($('#screenCards').querySelectorAll('.board-empty').length,5);
assert.equal($('#screenTotal strong').textContent,'0명');
assert.doesNotMatch($('#screenCards').textContent,/예약 가능/);
assert.equal($('#screenBoard .screen-note'),null);
assert.doesNotMatch($('#screenBoard').textContent,/사진 없는 현황판|20초마다 갱신|관리자 자동 잠금 시 종료/);
assert.equal($('[data-screen-place="코트 1"]').classList.contains('board-position-1'),true);
assert.equal($('[data-screen-place="코트 4"]').classList.contains('board-position-4'),true);
board([booking('농구 왼쪽 반코트',6),booking('코트 4',1),booking('휴식',8),booking('코트 2',4,{status:'취소'})]);
assert.equal($('#screenTotal strong').textContent,'15명');
assert.match($('#screenTotal small').textContent,/코트 7명 · 휴식 8명/);
assert.equal($('[data-screen-place="코트 1"]'),null);assert.equal($('[data-screen-place="코트 3"]'),null);
assert.ok($('[data-screen-place="코트 2"]'));assert.ok($('[data-screen-place="코트 4"]'));
assert.equal($('.board-half-left .screen-members').children.length,6);
assert.equal($('.board-half-left .board-count').textContent,'6/8');
assert.equal($('.board-rest .screen-members').children.length,8);
board([booking('농구 오른쪽 반코트',4)]);
assert.ok($('.board-half-right'));assert.equal($('[data-screen-place="코트 2"]'),null);assert.equal($('[data-screen-place="코트 4"]'),null);
assert.ok($('[data-screen-place="코트 1"]'));assert.ok($('[data-screen-place="코트 3"]'));
board([booking('농구 왼쪽 반코트',8),booking('농구 오른쪽 반코트',4),booking('코트 5',2)]);
assert.equal($('#screenTotal strong').textContent,'14명');
assert.equal($('#screenCards').querySelectorAll('[data-screen-place]').length,3);
assert.equal($('#screenCards').querySelectorAll('.board-basketball').length,2);
for(const n of [10,12,20]){
 board([booking('배구',n),booking('휴식',8),booking('코트 5',2)]);
 assert.equal($('#screenTotal strong').textContent,String(n+10)+'명');
 assert.equal($('#screenCards').querySelectorAll('[data-screen-place]').length,2);
 assert.equal($('.board-volleyball .screen-members').children.length,n);
 assert.equal($('.board-volleyball .board-count').textContent,n+'/20');
 assert.match($('.board-volleyball').textContent,/대체육관 전체 사용/);
 assert.equal($('.board-basketball'),null);
 assert.equal($('[data-screen-place="코트 5"] .board-count').textContent,'2/4');
}
board([],'시설 점검');assert.match($('.board-empty').textContent,/휴관/);
console.log('PASS board physical positions, left/right/both basketball merges, volleyball 10/12/20, independent small gym, empty/closed states, active-only totals and removed note');

w.eval('closeScreen()');assert.equal($('#screenCards').childElementCount,0);
assert.equal($('#screenBoard').classList.contains('hidden'),true);
assert.deepEqual(errors.map(e=>e.message),[]);
// Failed initial loads are actionable, and duplicate refreshes share one request.
w.eval("state.pub.days=null;publicLoadPromise=null;window.publicCalls=0;api=()=>{window.publicCalls++;return new Promise((resolve,reject)=>{window.resolvePublic=resolve;window.rejectPublic=reject})}");
const pendingLoad=w.eval('loadPublic()');
assert.equal(w.eval('loadPublic()'),pendingLoad);
assert.equal(w.publicCalls,1);
assert.equal($('#reserveSteps').disabled,true);
w.rejectPublic(new Error('잠금 시간초과'));
await pendingLoad;
assert.match($('#publicLoadMessage').textContent,/잠금 시간초과/);
assert.equal($('#btnRetryPublic').disabled,false);
assert.equal($('#publicLoadStatus').classList.contains('hidden'),false);
assert.doesNotMatch($('#placeMap').textContent,/불러오는 중/);
$('#btnRetryPublic').click();
assert.equal(w.publicCalls,2);
w.resolvePublic({ok:true,today:'2026-11-22',days:[{date:'2026-11-23',closed:false,occupancy:w.eval('emptyOcc()')}],notices:[],restCapacity:30});
await w.eval('publicLoadPromise');
assert.equal($('#publicLoadStatus').classList.contains('hidden'),true);
assert.equal($('#reserveSteps').disabled,false);
assert.match($('#reserveTitle').textContent,/11월 23일/);
console.log('PASS initial load failure, persistent error/retry, disabled stale form, duplicate request coalescing and successful retry');

dom.window.close();reloaded.window.close();
console.log('PASS DOM initialization, school toggle/defaults, court conflict UI, exact copy, three-attempt warning, countdown, persisted reload, expiry, screen privacy and escaped names');
})().catch(e=>{console.error(e);process.exit(1)});
