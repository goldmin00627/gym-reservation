const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const code=fs.readFileSync('public/board-media.js','utf8');
(async()=>{
const dom=new JSDOM('<div id="board"><header class="board-header"></header><div class="screen-cards"></div></div>',{url:'https://gym.test',runScripts:'outside-only'}),w=dom.window;
let ms=0,time={date:'2026-11-23',minute:739},starts=0,stops=0,finished=0;
w.setInterval=()=>1;w.clearInterval=()=>{};
class AC {constructor(){this.state='suspended'}resume(){this.state='running';return Promise.resolve()}suspend(){this.state='suspended';return Promise.resolve()}decodeAudioData(){return Promise.resolve({})}createBufferSource(){return {connect(){},start(){starts++},stop(){stops++}}}get destination(){return {}}}
w.AudioContext=AC;w.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});
w.eval(code);const api=w.GymBoardMedia;
assert.deepEqual(JSON.parse(JSON.stringify(api.clock(new Date('2026-11-23T03:20:00Z')))),{date:'2026-11-23',minute:740});
for(const file of api.assets)assert.ok(fs.existsSync('public/'+file));
for(const file of ['closing.webp','closing-from-40s.mp3'])assert.ok(fs.existsSync('public/board-media/'+file));
const host=w.document.getElementById('board');
const media=api.create(host,{now:()=>ms,clock:()=>time,random:()=>.2,isOpenDay:()=>true,onFinish:()=>{finished++;media.stop()}});
const image=()=>host.querySelector('.board-background.visible').style.backgroundImage;
media.start();await new Promise(r=>setTimeout(r,0));
const first=image();ms=59999;media.tick();assert.equal(image(),first);
const slides=[first];for(let i=1;i<10;i++){ms=i*60000;media.tick();slides.push(image())}
assert.equal(new Set(slides).size,10,'one full deck has no duplicates');
ms=600000;media.tick();assert.notEqual(image(),slides.at(-1),'no repeated image at shuffle boundary');
time.minute=740;media.tick();await new Promise(r=>setTimeout(r,0));
assert.equal(host.classList.contains('is-closing'),true);assert.equal(host.querySelector('.board-closing').hidden,false);assert.equal(starts,1);
for(let i=0;i<4;i++)media.tick();await new Promise(r=>setTimeout(r,0));assert.equal(starts,1,'no audio loop');
time.minute=745;media.tick();assert.equal(finished,1);assert.equal(media.isActive(),false);assert.ok(stops);
time.minute=742;media.start();await new Promise(r=>setTimeout(r,0));assert.equal(starts,1,'same day reopening cannot replay automatically');media.stop();
time={date:'2026-11-24',minute:740};media.start();await new Promise(r=>setTimeout(r,0));assert.equal(starts,2,'next day plays once');media.stop();
const denied=api.create(host,{now:()=>ms,clock:()=>time,isOpenDay:()=>false});denied.start();assert.equal(host.classList.contains('is-closing'),false);denied.stop();
w.AudioContext=class extends AC{resume(){return Promise.reject(new Error('NotAllowedError'))}};
time={date:'2026-11-25',minute:740};const fallback=api.create(host,{clock:()=>time});fallback.start();await new Promise(r=>setTimeout(r,0));
const panels=[...host.querySelectorAll('.board-closing')];assert.equal(panels.at(-1).querySelector('button').hidden,false,'blocked audio offers explicit play');fallback.stop();
assert.equal(panels.at(-1).hidden,true);
dom.window.close();console.log('PASS 60-second shuffled 10-image decks, boundary non-repeat, KST 12:20/12:25, audio once per day, reopen, next day, closed day, autoplay fallback and stop');
})().catch(e=>{console.error(e);process.exit(1)});
