/* Projector-only presentation. No credentials or reservation data are stored here. */
(function (root) {
  'use strict';
  const names = ['01_sunlit_wood_gym','02_badminton_closeup','03_basketball_hoop','04_volleyball_net','05_blue_green_pattern','06_table_tennis_topdown','07_court_blueprint','08_ceiling_lights_night','09_equipment_flatlay','10_ball_trajectories'];
  const assets = names.map(n => 'board-media/' + n + '.webp');
  function shuffle(values, random = Math.random) {
    const a = values.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function clock(date = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
    return {date:p.year+'-'+p.month+'-'+p.day, minute:Number(p.hour)*60+Number(p.minute)};
  }
  function create(host, options = {}) {
    const now = options.now || (() => Date.now());
    const getClock = options.clock || (() => clock(new Date(now())));
    const random = options.random || Math.random;
    const bg = document.createElement('div'); bg.className = 'board-backgrounds'; bg.setAttribute('aria-hidden','true');
    const layers = [0,1].map(() => { const n=document.createElement('div'); n.className='board-background'; bg.append(n); return n; }); host.prepend(bg);
    const closing = document.createElement('div'); closing.className='board-closing'; closing.hidden=true;
    const picture=document.createElement('img');picture.src='board-media/closing.webp';picture.alt='체육관 마감 5분 전. 다음 5교시 수업에 방해되지 않게 퇴장해 주세요.';
    const play=document.createElement('button');play.type='button';play.textContent='안내음 재생';play.hidden=true;
    const exit=document.createElement('button');exit.type='button';exit.className='board-closing-exit';exit.textContent='현황판 닫기';exit.addEventListener('click',()=>options.onClose?.());
    closing.append(picture,play,exit);host.append(closing);
    let active=false, closingNow=false, timer=null, deck=[], current=-1, layer=0, changed=0, epoch=0;
    let context=null, buffer=null, loading=null, source=null, playingDate='', starting=false;
    function next() {
      if (!deck.length) { deck=shuffle(assets.map((_,i)=>i),random); if(deck.length>1 && deck[0]===current) [deck[0],deck[1]]=[deck[1],deck[0]]; }
      current=deck.shift();layer=1-layer;
      layers[layer].style.backgroundImage='url("'+assets[current]+'")';
      layers[layer].classList.add('visible');layers[1-layer].classList.remove('visible');
    }
    function played(date) { try { return sessionStorage.getItem('gym.closingPlayed')===date; } catch { return playingDate===date; } }
    function remember(date) { playingDate=date;try{sessionStorage.setItem('gym.closingPlayed',date);}catch{} }
    function stopAudio() { if(source){try{source.stop();}catch{}source=null;} }
    function prepare() {
      try {
        const Audio = root.AudioContext || root.webkitAudioContext;
        if(!Audio) return Promise.reject(new Error('이 브라우저는 자동 안내음을 지원하지 않습니다.'));
        if(!context || context.state==='closed')context=new Audio();
        // Must happen synchronously in the projector-open button's user gesture.
        const resumed=context.resume();
        if(!loading) loading=fetch('board-media/closing-from-40s.mp3').then(r=>{if(!r.ok)throw new Error('음원 불러오기 실패');return r.arrayBuffer();}).then(b=>context.decodeAudioData(b)).then(b=>{buffer=b;return b;}).catch(e=>{loading=null;throw e;});
        return Promise.all([resumed,loading]);
      } catch(e){return Promise.reject(e);}
    }
    async function sound(date, generation) {
      if(starting || played(date)) return;
      starting=true;
      try {
        await prepare();
        if(!active || !closingNow || generation!==epoch)return;
        if(context.state!=='running')throw new Error('소리 활성화 필요');
        source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
        source.start(0);remember(date);play.hidden=true;
      } catch(e) { if(active && closingNow && generation===epoch)play.hidden=false; }
      finally { starting=false; }
    }
    function tick() {
      if(!active)return;
      const time=getClock();
      const due=time.minute>=740 && time.minute<745 && (options.isOpenDay ? options.isOpenDay(time.date) : true);
      if(due){
        if(!closingNow){closingNow=true;host.classList.add('is-closing');closing.hidden=false;sound(time.date,epoch);}
        return;
      }
      if(closingNow){closingNow=false;closing.hidden=true;host.classList.remove('is-closing');stopAudio();options.onFinish?.();return;}
      if(now()-changed>=60000){next();changed=now();}
    }
    play.addEventListener('click',()=>sound(getClock().date,epoch));
    function start() {
      if(active)return;active=true;epoch++;deck=[];next();changed=now();
      prepare().catch(()=>{if(active && closingNow)play.hidden=false;});
      timer=setInterval(tick,1000);tick();
    }
    function stop() {
      active=false;epoch++;clearInterval(timer);timer=null;closingNow=false;closing.hidden=true;play.hidden=true;host.classList.remove('is-closing');stopAudio();
      if(context?.state==='running')context.suspend().catch(()=>{});
    }
    const visible=()=>{if(active){if(context?.state==='suspended' && closingNow && !played(getClock().date))sound(getClock().date,epoch);tick();}};
    document.addEventListener('visibilitychange',visible);root.addEventListener('pageshow',visible);
    return {start,stop,tick,isActive:()=>active};
  }
  root.GymBoardMedia={create,shuffle,clock,assets};
})(window);
