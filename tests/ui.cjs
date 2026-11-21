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
$('#schoolToggle').click();
assert.equal($('#schoolToggle').getAttribute('aria-checked'),'true');
assert.equal($('#schoolModeLabel').textContent,'고등학교 예약');
assert.equal(w.eval('blankMember().school'),'고');
assert.equal(w.eval('state.members.every(m=>m.school === "고")'),true);
// Occupancy must disable basketball even when only one overlapping badminton player booked.
w.eval(`state.pub.bookable=true;state.pub.occupancy=emptyOcc();state.pub.occupancy['코트 3'].people=1;renderPlaces();`);
assert.equal($('[data-place="농구 왼쪽 반코트"]').getAttribute('aria-disabled'),'true');
assert.equal($('[data-place="농구 오른쪽 반코트"]').getAttribute('aria-disabled'),null);
assert.match($('[data-place="배구"]').textContent,/10~20명/);
$('[data-place="농구 오른쪽 반코트"]').click();
assert.equal(w.eval('state.type'),'group'); assert.equal(w.eval('state.members.length'),4);
assert.equal(w.eval('memberLimits().max'),8);
for(let i=0;i<4;i++) $('#btnAddMember').click();
assert.equal(w.eval('state.members.length'),8); assert.equal($('#btnAddMember').disabled,true);
assert.match($('#typeNote').textContent,/4~8명/);
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
w.eval('closeScreen()');assert.equal($('#screenCards').childElementCount,0);
assert.equal($('#screenBoard').classList.contains('hidden'),true);
assert.deepEqual(errors.map(e=>e.message),[]);
dom.window.close();reloaded.window.close();
console.log('PASS DOM initialization, school toggle/defaults, court conflict UI, exact copy, three-attempt warning, countdown, persisted reload, expiry, screen privacy and escaped names');
})().catch(e=>{console.error(e);process.exit(1)});
