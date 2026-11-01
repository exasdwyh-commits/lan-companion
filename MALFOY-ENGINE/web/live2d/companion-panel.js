'use strict';
(()=>{
  const host=window.malfoyHost,$=id=>document.getElementById(id);let state=null;
  const status=t=>$('media-status').textContent=t;
  function show(tab){
    if(!['chat','singing','reading'].includes(tab))return;
    document.body.dataset.tab=tab;
    for(const button of document.querySelectorAll('nav [data-tab]'))button.setAttribute('aria-selected',String(button.dataset.tab===tab));
    if(tab!=='chat')void load($('song-search').value);
    if(tab==='singing'){void cover({action:'state'});void vocalist({action:'state'});}
  }
  function render(p){
    state=p;const book=p.book;
    $('book-title').textContent=book?prettyTitle(book.title):'一起读一本书';
    // 有章节时先说章（长篇的导航单位是章），没有就只报段落。
    // 用标题而不是序号：「Chapter 12」「第X卷」按序号会显示成「第 1 章」，是错的。
    const ch=Array.isArray(book?.chapters)?book.chapters:[];
    const curCh=book&&book.chapter>=0?ch[book.chapter]:null;
    const inCh=curCh?`${curCh.title} · `:'';
    $('reader-progress').textContent=book?`${inCh}第 ${book.index+1} / ${book.total} 段 · 已保存进度`:'尚未导入文字';
    renderChapters(book);
    $('reader-text').textContent=book?.text||'';
    renderCast(book);
    const an=book?.analysis;
    $('reader-analysis').textContent=
      an?.status==='running'?'她正在读这本书，认角色…':
      an?.status==='ready'?`已认出 ${an.characters?.length||0} 个角色${an.chunks>1?` · 读了前 ${an.chunks} 段`:''}${an.isFiction===false?' · 这本书不太像小说':''}${an.via?`（${an.via}）`:''}`:
      an?.status==='failed'?`角色分析没成（${an.error||'模型不可用'}），先按规则分着读。`:'';
    $('analyze-book').disabled=!book||an?.status==='running';
    syncMode();
    $('start-reading').disabled=!book;
    $('previous-paragraph').disabled=!book||book.index===0;
    $('next-paragraph').disabled=!book||book.index>=book.total-1;
    const labels={idle:'选择一首歌，或导入想读的文字。',ready:'已就绪，点「开始朗读」继续。',loading:'正在准备这一段的语音…',playing:p.kind==='singing'?`正在唱：${p.title||''}`:'正在朗读',paused:'已暂停，点「继续」。',stopped:'已停止，可继续当前段。',ended:'播放完成。',error:p.error||'播放失败，请重试。'};
    status(labels[p.status]||'');
    syncPlaying(p);
  }
  async function command(p){
    if(!host?.media){status('请从深蓝应用打开此功能。');return;}
    try{const r=await host.media(p);if(!r.ok)status(r.error||'操作失败。');else render(r.state);return r;}catch(_){status('连接中断，请重试。');}
  }
  /**
   * 章节目录。没有章节的书整块不渲染 —— 空目录比没有目录更让人困惑。
   * render() 被每次播放进度驱动（约 4 次/秒），整块重建会把用户正拉开的下拉框关掉，
   * 所以只在章节表本身变化时重建，切章只改选中项。
   */
  let chapterSig='';
  function renderChapters(book){
    const box=$('reader-chapters');
    const list=Array.isArray(book?.chapters)?book.chapters:[];
    if(!book||!list.length){if(chapterSig){box.replaceChildren();chapterSig='';}return;}
    const sig=list.map(c=>`${c.index}:${c.title}`).join('|');
    if(sig!==chapterSig){
      chapterSig=sig;
      box.replaceChildren();
      const sel=document.createElement('select');
      sel.setAttribute('aria-label','跳转到章节');
      const head=document.createElement('option');
      head.value='';head.textContent=`目录 · 共 ${list.length} 章`;
      sel.appendChild(head);
      for(const c of list){
        const o=document.createElement('option');o.value=String(c.index);o.textContent=c.title;
        sel.appendChild(o);
      }
      sel.onchange=()=>{const v=sel.value;if(v==='')return;void command({action:'jump',chapter:Number(v)});};
      box.appendChild(sel);
    }
    const sel=box.querySelector('select');
    if(sel)sel.value=book.chapter>=0?String(book.chapter):'';
  }
  /**
   * 配音表。之前只能看不能改 —— 音色全写在 narration.js 的 VOICE_POOL 里，
   * 认错了就只能改代码。现在每个角色一个下拉框，改完立刻按新表重切朗读稿。
   */
  function renderCast(book){
    const box=$('reader-cast');box.replaceChildren();
    const cast=Array.isArray(book?.cast)?book.cast:[];
    if(!book||book.mode!=='studio'||!cast.length)return;
    const voices=Array.isArray(book.voices)?book.voices:[];
    const hint=document.createElement('small');hint.textContent='配音 · 旁白用她的声音';
    box.appendChild(hint);
    for(const c of cast){
      const row=document.createElement('label');row.className='cast-row';
      const name=document.createElement('span');name.textContent=c.name;
      const sel=document.createElement('select');
      sel.setAttribute('aria-label',`${c.name} 的音色`);
      for(const v of voices){
        const o=document.createElement('option');o.value=v.id;o.textContent=v.label;
        if(v.id===c.voice)o.selected=true;
        sel.appendChild(o);
      }
      sel.onchange=()=>{void command({action:'set-cast',name:c.name,voice:sel.value});};
      row.append(name,sel);box.appendChild(row);
    }
  }
  // 还没导入书时先记住用户选的模式，导入时带上
  let readerMode='studio';
  function syncMode(){
    const active=state?.book?.mode||readerMode;
    for(const b of document.querySelectorAll('#reader-mode [data-reader-mode]'))b.setAttribute('aria-pressed',String(b.dataset.readerMode===active));
  }
  /** 秒 -> m:ss。时长在索引里存好了，这里只负责格式化。 */
  function clock(sec){
    if(!Number.isFinite(sec)||sec<=0)return '';
    const t=Math.round(sec),m=Math.floor(t/60);
    return `${m}:${String(t%60).padStart(2,'0')}`;
  }
  /**
   * 上架用的书名。下载来的 TXT 常带发布号（「爱如灰烬-178348275950」），
   * 那不是书名，是来源编号。只影响显示，真名仍在 title 属性里。
   * 新导入的书已经由 read-ebook.py 从正文「书名：」取到干净名字，这里是老数据的兜底。
   */
  function prettyTitle(name){
    const raw=String(name||'');
    return raw.replace(/[-_ ]\d{6,}$/,'').trim()||raw;
  }
  /** 一首歌一行：封面块（按来源分色）+ 标题/来源 · 时长 + 播放态。翻唱和原曲共用。 */
  function trackRow(song){
    const row=document.createElement('button');
    row.type='button';row.className='track';row.dataset.songId=song.id;
    const art=document.createElement('span');
    art.className='track-art';art.dataset.source=song.source;
    // 「创」= 她自己写的。三个来源要一眼分开：翻唱是别人的歌，原曲是样例。
    art.textContent=song.source==='cover'?'翻':song.source==='original'?'创':'原';
    const main=document.createElement('span');main.className='track-main';
    const title=document.createElement('strong');title.textContent=song.title;
    const meta=document.createElement('small');
    const bits=[song.locked?`需要 ${song.unlockAt} 好感`:
      song.source==='original'?(song.her?'她写的 · 她唱的':'她写的'):song.source==='cover'?'她的翻唱':(song.credit||'随包原曲')];
    const d=clock(song.duration);
    if(d)bits.push(d);
    meta.textContent=bits.join(' · ');
    // 引擎串（seed-vc-svc-f0-44k+studio）对用户是噪音，只留在 tooltip 里方便对照效果
    if(song.engine)row.title=`${song.title} · ${song.engine}`;
    main.append(title,meta);
    const action=document.createElement('span');action.className='track-action';
    const play=document.createElement('span');play.className='track-play';play.textContent=song.locked?'锁定':'▶';
    const eq=document.createElement('span');eq.className='track-eq';eq.setAttribute('aria-hidden','true');
    for(let i=0;i<3;i++)eq.appendChild(document.createElement('i'));
    action.append(play,eq);
    row.append(art,main,action);
    row.setAttribute('aria-label',`${song.locked?'未解锁':'播放'} ${song.title}`);
    if(song.locked)row.disabled=true;else row.onclick=()=>command({action:'song',id:song.id});
    return row;
  }
  /**
   * 曲库列表。默认按来源分组（自己的翻唱在前）；历史实验样例用 grouped=false 平铺。
   * 空态必须给人下一步 —— 「曲库还是空的」等于把用户丢在原地。
   */
  function renderLibrary(box,list,{grouped=true,empty=''}={}){
    box.replaceChildren();
    if(!list.length){
      if(!empty)return;
      const p=document.createElement('p');p.className='shelf-empty';p.textContent=empty;
      box.appendChild(p);return;
    }
    if(!grouped){for(const s of list)box.appendChild(trackRow(s));return;}
    // 她自己写的排最前：那不是「唱别人的歌」，是她的东西。
    for(const [key,label] of [['original','她自己写的'],['cover','她自己的翻唱'],['pack','随包原曲']]){
      const part=list.filter(s=>s.source===key);
      if(!part.length)continue;
      const head=document.createElement('div');head.className='track-group';head.textContent=label;
      box.appendChild(head);
      for(const s of part)box.appendChild(trackRow(s));
    }
  }
  /**
   * 播放态只翻属性，不重建列表：render() 被播放进度驱动（约 4 次/秒），
   * 每帧重建会把滚动位置和搜索焦点一起冲掉。memo 是为了连属性都少写几次。
   */
  let playingId=null,playingOn=false;
  function syncPlaying(p){
    const id=p?.kind==='singing'?p.songId:null;
    // 选中态跟着歌曲走（暂停也还算这首），但只有真的在播才让柱子动
    const live=Boolean(id)&&p?.status==='playing';
    if(id===playingId&&live===playingOn)return;
    playingId=id;playingOn=live;
    for(const row of document.querySelectorAll('.track')){
      const hit=Boolean(id)&&row.dataset.songId===id;
      row.setAttribute('aria-current',String(hit));
      row.dataset.live=String(hit&&live);
    }
  }
  /**
   * 书架：卡片网格。常驻显示 —— 一本都没有时给一句怎么加书，
   * 比整块消失更好用（之前只有两本以上才出现，新用户根本不知道有书架）。
   * 在读的那本不可移出（移了会连进度一起丢），由 `remove-book` 自己拦。
   */
  function renderShelf(data){
    const box=$('book-shelf');box.replaceChildren();
    const list=Array.isArray(data?.books)?data.books:[];
    const count=$('shelf-count');if(count)count.textContent=list.length?`${list.length} 本`:'';
    if(!list.length){
      const empty=document.createElement('p');empty.className='shelf-empty';
      empty.textContent='书架还空着。点上面的「打开电子书」，或把文字粘进下面的「导入 / 更换文本」，第一本就上架了。';
      box.appendChild(empty);return;
    }
    for(const b of list){
      const card=document.createElement('div');card.className='book';
      const isCurrent=b.id===data.currentBookId;
      if(isCurrent)card.setAttribute('aria-current','true');
      const open=document.createElement('button');
      open.type='button';open.className='book-open';
      const title=document.createElement('strong');title.textContent=prettyTitle(b.title);
      if(b.title!==title.textContent)title.title=b.title;
      const meta=document.createElement('small');
      const bits=[];
      if(b.paragraphs)bits.push(`${b.paragraphs} 段`);
      if(b.chapters)bits.push(`${b.chapters} 章`);
      if(b.updatedAt){try{bits.push(new Date(b.updatedAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}));}catch(_){}}
      meta.textContent=bits.join(' · ');
      open.append(title,meta);
      open.onclick=()=>command({action:'open-book',id:b.id});
      card.appendChild(open);
      if(isCurrent){
        const tag=document.createElement('span');tag.className='book-tag';tag.textContent='在读';
        card.appendChild(tag);
      }else{
        const del=document.createElement('button');
        del.type='button';del.className='book-remove';del.textContent='移出';
        del.setAttribute('aria-label',`把《${b.title}》移出书架`);
        del.onclick=async()=>{
          const r=await command({action:'remove-book',id:b.id});
          if(r?.ok)void load($('song-search').value);
        };
        card.appendChild(del);
      }
      box.appendChild(card);
    }
  }
  /** 她的旅行日记：只读，最近 10 条。见闻是落盘的，所以攒得下来。 */
  function renderJourney(j){
    const box=$('journey-list');if(!box)return;
    box.replaceChildren();
    const list=Array.isArray(j?.diary)?j.diary:[];
    if(!list.length){
      const p=document.createElement('p');
      p.textContent='她还没出过门。每隔两小时她会自己出去走走，回来带一张明信片。';
      box.appendChild(p);return;
    }
    for(const e of list.slice(0,10)){
      const row=document.createElement('div');row.className='journey-item';
      const head=document.createElement('strong');head.textContent=e.place||'某个地方';
      const when=document.createElement('small');
      try{when.textContent=new Date(e.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}catch(_){}
      const note=document.createElement('p');note.textContent=e.note||'';
      row.append(head,when,note);box.appendChild(row);
    }
  }
  async function loadJourney(){
    if(!host?.journey)return;
    try{renderJourney(await host.journey());}catch(_){}
  }
  host?.onJourneyState?.(renderJourney);

  async function load(query){
    if(!host?.library){status('请从深蓝应用打开此功能。');return;}
    try{
      const data=await host.library(query);render(data);renderShelf(data);
      const all=Array.isArray(data.songs)?data.songs:[];
      const main=all.filter(s=>!s.experimental);
      const q=String(query||'').trim();
      // 统一曲库：翻唱在前、原曲在后；旧念词实验折进下面的「历史实验样例」
      // 空态不额外画一块占位：曲库空的时候「学新歌」会自己展开，说明放那儿就够
      renderLibrary($('song-list'),main,{empty:q?`没找到「${q}」相关的歌。`:''});
      renderLibrary($('songs'),all.filter(s=>s.experimental),{grouped:false});
      // 首数 + 总时长：曲库有多少东西，一眼能看出来
      const total=main.reduce((n,s)=>n+(Number.isFinite(s.duration)?s.duration:0),0);
      $('song-count').textContent=main.length
        ?(total?`${main.length} 首 · ${clock(total)}`:`${main.length} 首`)
        :'';
      // 一首歌都没有时，搜索框和播放控制都没有可作用的对象，留着只是噪音。
      // 但「搜出来 0 条」不是「曲库空」—— 这时候把搜索框藏了，用户连清空都做不到。
      $('song-search').hidden=!main.length&&!q;
      const controls=document.querySelector('#singing-panel .play-controls');
      if(controls)controls.hidden=!main.length&&!state?.kind;
      // 空曲库时把「学新歌」摊开；有歌之后只保留用户的展开状态，不强行收起
      if(!main.length)$('cover-studio').open=true;
      $('song-hint').textContent=main.length
        ?'她自己唱的都在这儿。她自己写的排最前面。'
        :'她还没唱过歌。下面挑一首原曲换她的声音，或者让她写一首新的。';
      $('reader-import').open=!data.book;
      // 列表刚重建，播放态要重新落到新节点上（memo 不清会以为没变化而跳过）
      playingId=null;playingOn=false;syncPlaying(state);
      void loadJourney();
    }catch(_){status('曲库暂时无法读取，请重试。');}
  }
  // 搜索防抖：每敲一个字都发一次 IPC 没必要
  let searchTimer=null;
  $('song-search').oninput=()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{void load($('song-search').value);},200);
  };
  // 半音数带符号，让「升」和「降」在面板上一眼分得开
  const fmtShift=n=>`${n>0?'+':''}${n} 半音`;
  /**
   * 音色选择：一排胶囊。缺参考音频的那档要留着并说明缺什么，
   * 不能悄悄藏起来 —— 否则用户以为「没有孙燕姿这个选项」，
   * 而不是「还差一段她的干净人声」。
   */
  function renderVoices(list){
    const box=$('voice-picker'),voices=Array.isArray(list)?list:[];
    box.replaceChildren();
    if(!voices.length){$('voice-name').textContent='—';$('voice-note').textContent='';return;}
    for(const v of voices){
      const chip=document.createElement('button');
      chip.type='button';chip.className='voice-chip';
      chip.textContent=v.usable?v.name:`${v.name}·待启用`;
      chip.setAttribute('aria-pressed',String(Boolean(v.current)));
      // 不设 disabled：点一下后端会回「缺什么、该放到哪个路径」，
      // 这比一个点不动的灰按钮有用得多。用 aria-disabled + 变淡表示状态。
      chip.dataset.off=String(!v.usable);
      chip.setAttribute('aria-disabled',String(!v.usable));
      chip.title=v.usable?(v.tone||''):`${v.tone||''}。需要一段干净人声（≥10 秒）才能用，点一下看具体路径。`;
      chip.onclick=()=>cover({action:'voice',id:v.id});
      box.appendChild(chip);
    }
    const here=voices.find(v=>v.current)||voices[0];
    $('voice-name').textContent=here?here.name:'—';
    $('voice-note').textContent=here
      ?(here.usable?(here.tone||''):`${here.tone||''}　还缺一段她的干净人声（≥10 秒），放进去就能用。`)
      :'';
  }
  /**
   * 分析结论：先给人话（什么调、多快、升几个半音），再给依据。
   * 用户要的是「这首歌该怎么调」，不是一串频率。
   */
  function renderAnalysis(a,t){
    const box=$('analysis');
    if(!a){box.hidden=true;box.replaceChildren();return;}
    box.hidden=false;
    box.dataset.conflict=String(Boolean(t?.conflict));
    const facts=[];
    if(a.key?.label)facts.push(a.key.label);
    if(a.tempo)facts.push(`${Math.round(a.tempo)} BPM`);
    if(a.vocal?.span)facts.push(`音域 ${a.vocal.span} 个半音`);
    const head=document.createElement('p');
    head.style.margin='0';
    const strong=document.createElement('strong');
    strong.textContent=facts.join(' · ')||'分析完成';
    head.appendChild(strong);
    const line=document.createElement('p');
    line.style.margin='4px 0 0';
    const shift=t?.recommended;
    if(shift===0||shift===null||shift===undefined){
      line.textContent=shift===0?'换她唱保持原调就够。':'还没测出推荐音域。';
    }else{
      line.textContent=`换她唱要升 ${shift} 个半音${t?.keyAfter?`，变成 ${t.keyAfter}`:''}。`;
    }
    box.replaceChildren(head,line);
    if(Array.isArray(a.advice)&&a.advice.length){
      const ul=document.createElement('ul');
      for(const text of a.advice.slice(0,2)){const li=document.createElement('li');li.textContent=text;ul.appendChild(li);}
      box.appendChild(ul);
    }
  }
  function renderCover(p){
    $('cover-source').textContent=p.selected?.title||'尚未选择歌曲';
    const busy=p.job&&['preparing','separating','converting','mixing','analyzing'].includes(p.job.status);
    // 制作中/刚做完时把折叠区展开，否则进度和完成提示都藏在用户看不见的地方
    if(busy||p.job?.status==='done'||p.job?.status==='preview-done')$('cover-studio').open=true;
    const t=p.tune||{};
    // semitones 为 null 表示「自动」——脚本会按原唱音域推算，这里只展示推算结果
    const auto=t.semitones===null||t.semitones===undefined;
    const shown=auto?(t.recommended??0):t.semitones;
    $('shift-range').disabled=!!busy;$('shift-auto').disabled=!!busy;
    $('shift-auto').setAttribute('aria-pressed',String(auto));
    // 用户正拖着滑块时不要回写 value，否则手指还在拖就被面板抢回旧值
    if(document.activeElement!==$('shift-range'))$('shift-range').value=String(shown);
    if(auto){
      $('shift-value').dataset.auto='true';
      $('shift-value').textContent=t.recommended!=null?`自动 · ${fmtShift(t.recommended)}`:'自动判定';
    }else{
      $('shift-value').dataset.auto='false';
      $('shift-value').textContent=fmtShift(t.semitones);
    }
    $('shift-note').textContent=t.reason||'男声原曲要升 K，女声才唱得实。默认按原唱音域自动算。';
    renderVoices(p.voices);
    renderAnalysis(p.analysis,t);
    // 分析是「先看结论再决定做不做」的入口，所以只要选了歌就能点，不必等模型就绪
    $('analyze-cover').disabled=!p.selected||!!busy;
    $('analyze-cover').textContent=p.analysis?'重新分析':'分析这首歌';
    $('analyze-state').textContent=p.job?.status==='analyzing'?'分析中…':'';
    $('choose-cover').disabled=!!busy;
    $('preview-cover').disabled=!!busy||!p.selected||!p.model.ready;
    $('preview-cover').dataset.ready=String(Boolean(p.preview));
    $('preview-cover').textContent=p.preview?'再听一版':'试听 25 秒';
    $('start-cover').disabled=!!busy||!p.selected||!p.model.ready;$('cancel-cover').disabled=!busy;
    const labels={analyzing:'正在分离人声并分析音域、BPM 和调性（第一次要几分钟，之后复用）…','analyze-done':'分析完成，上面是这首歌的方案。',preparing:'正在准备原曲…',separating:'正在分离人声和伴奏（第一次要几分钟，之后会复用）…',converting:'正在转换歌声音色并调整音域…',mixing:'正在把伴奏一起移调后混音…',done:'翻唱已完成，点击下方播放。', 'preview-done':`试听已生成${p.job?.shift?`（${fmtShift(p.job.shift)}）`:''}，正在播放。不满意就拖音域滑块再听一版。`,cancelled:'制作已取消。',error:p.job?.error};
    const progress=p.job?.status==='converting'&&p.job.progress?`（第 ${p.job.progress.current} / ${p.job.progress.total} 段）`:'';
    $('cover-status').textContent=(labels[p.job?.status]||(!p.model.ready?p.model.error:'歌声模型已就绪；先试听 25 秒确认音域，满意再做整首。'))+progress;
    // 列表统一由曲库渲染 —— 刚做完的翻唱也会出现在里面，这里只负责刷新一次
    const now=p.job?.status||null;
    if(now==='done'&&lastCoverStatus!=='done')void load($('song-search').value);
    lastCoverStatus=now;
  }
  let lastCoverStatus=null;
  /**
   * 歌姬模式。和翻唱相反：翻唱是「已经有的歌换她的声音」，
   * 这里是「还没有的歌由她造出来」。所以这一块的点是歌词 —— 用户看得见、改得动。
   * 三件事各自可有可无：写词失败能自己写，作曲失败前面的都还在，换声环境不在也能出歌。
   */
  let vocalistState=null,lastVocalistStatus=null;
  function renderVocalist(v){
    if(!v)return;
    vocalistState=v;
    const busy=Boolean(v.job&&['writing','composing','encoding','dressing'].includes(v.job.status));
    if(busy||v.job?.status==='done')$('vocalist').open=true;
    const d=v.draft||{};
    // 用户正在打字时不要回写：每敲一个字就抢回旧值，等于不让人输入
    for(const [id,val] of [['vocalist-theme',d.theme],['vocalist-style',d.style],['vocalist-lyrics',d.lyrics]]){
      const el=$(id);if(document.activeElement!==el&&el.value!==(val||''))el.value=val||'';
    }
    $('vocalist-write').disabled=busy;
    $('vocalist-generate').disabled=busy||!v.ready?.configured;
    $('vocalist-cancel').disabled=!busy;
    const song=v.song;
    $('vocalist-result').hidden=!song;
    if(song){
      $('vocalist-title').textContent=song.title||'无题';
      const bits=[song.herUrl?'她本人的声音':'生成版'];
      const len=clock(song.duration);if(len)bits.push(len);
      if(song.model)bits.push(song.model);
      $('vocalist-meta').textContent=bits.join(' · ');
      // 有她唱版才需要「听生成版」这个切换；没有的话两个按钮说的是同一件事，只会让人困惑
      $('vocalist-play-alt').hidden=!song.herUrl;
      $('vocalist-dress').textContent=song.herUrl?'重新让她唱':'让她本人唱';
      $('vocalist-dress').disabled=busy||!v.dress?.ready;
      $('vocalist-dress').title=v.dress?.ready?`用「${v.dress.voice||'她的音色'}」重唱一遍`:(v.dress?.error||'');
      $('vocalist-lyrics-view').textContent=song.lyrics||'';
    }
    const labels={
      writing:'她正在想词…',
      composing:'正在谱曲（一般半分钟到两分钟）…',
      encoding:'正在转码…',
      dressing:'正在换成她的声音（第一次要几分钟，之后复用）…',
      done:song?.herUrl?'做好了，她本人唱的版本已经放进曲库。':'做好了。点「让她本人唱」还能换成她的音色。',
      cancelled:'已取消，草稿还在。',
      error:v.job?.error,
    };
    let text=labels[v.job?.status]||'';
    if(!text&&!v.ready?.configured)text=v.ready?.error||'';
    if(!text)text='填个主题，或者自己写几句歌词，然后点「作曲」。';
    $('vocalist-status').textContent=text;
    // 做完要立刻在曲库看到 —— 不做的话用户会以为白做了
    if(v.job?.status==='done'&&lastVocalistStatus!=='done')void load($('song-search').value);
    lastVocalistStatus=v.job?.status||null;
  }
  async function vocalist(p){
    try{
      const r=await host?.vocalist?.(p);
      if(r?.ok)renderVocalist(r.state);
      else if(!r?.cancelled)$('vocalist-status').textContent=r?.error||'创作功能连接失败。';
      return r;
    }catch(_){$('vocalist-status').textContent='创作功能连接失败。';}
  }
  const draftPatch=()=>({theme:$('vocalist-theme').value,style:$('vocalist-style').value,lyrics:$('vocalist-lyrics').value});
  $('vocalist-write').onclick=()=>vocalist({action:'write',patch:{theme:$('vocalist-theme').value,style:$('vocalist-style').value}});
  // 歌词也一起传：用户可能已经手改过，生成时用的是框里的，不是后端记着的
  $('vocalist-generate').onclick=()=>vocalist({action:'generate',patch:draftPatch()});
  $('vocalist-cancel').onclick=()=>vocalist({action:'cancel'});
  $('vocalist-dress').onclick=()=>vocalist({action:'dress'});
  // 默认播「她」那版（有的话）；生成版单独一个按钮，用来对照效果
  $('vocalist-play').onclick=()=>vocalistState?.song&&vocalist({action:'play',id:vocalistState.song.id});
  $('vocalist-play-alt').onclick=()=>vocalistState?.song&&vocalist({action:'play',id:vocalistState.song.id,which:'main'});
  // 改完就存草稿：切走再回来不该发现自己写了一半的词没了
  for(const id of ['vocalist-theme','vocalist-style','vocalist-lyrics'])$(id).onchange=()=>vocalist({action:'draft',patch:draftPatch()});
  host?.onVocalistState?.(renderVocalist);
  async function cover(p){try{const r=await host?.cover?.(p);if(r?.ok)renderCover(r.state);else if(!r?.cancelled)$('cover-status').textContent=r?.error||'翻唱连接失败。';}catch(_){$('cover-status').textContent='翻唱连接失败。';}}
  $('choose-cover').onclick=()=>cover({action:'choose'});$('start-cover').onclick=()=>cover({action:'start'});$('cancel-cover').onclick=()=>cover({action:'cancel'});
  $('preview-cover').onclick=()=>cover({action:'preview'});
  $('analyze-cover').onclick=()=>cover({action:'analyze'});
  // 拖动时先本地更新数字（不打断手感），松手才提交 —— 每次 change 都会走一趟 IPC
  $('shift-range').oninput=()=>{$('shift-value').textContent=fmtShift(Number($('shift-range').value));$('shift-value').dataset.auto='false';};
  $('shift-range').onchange=()=>cover({action:'tune',semitones:Number($('shift-range').value)});
  $('shift-auto').onclick=()=>cover({action:'tune',semitones:null});
  host?.onCoverState?.(renderCover);
  for(const b of document.querySelectorAll('nav [data-tab]'))b.onclick=()=>show(b.dataset.tab);
  for(const b of document.querySelectorAll('[data-media]'))b.onclick=()=>command({action:b.dataset.media});
  $('open-book').onclick=async()=>{try{const r=await host?.openBook?.();if(r?.ok)render(r.state);else if(!r?.cancelled)status(r?.error||'无法打开电子书。');}catch(_){status('无法打开电子书。');}};
  $('start-reading').onclick=()=>command({action:'read'});
  $('previous-paragraph').onclick=()=>state?.book&&command({action:'jump',index:state.book.index-1});
  $('next-paragraph').onclick=()=>state?.book&&command({action:'jump',index:state.book.index+1});
  $('save-book').onclick=async()=>{
    const r=await command({action:'import',title:$('book-name').value,text:$('book-draft').value,mode:readerMode});
    // 导入后书架会多一本，重新拉一次曲库/书库快照
    if(r?.ok){$('book-draft').value='';$('reader-import').open=false;void load($('song-search').value);}
  };
  for(const b of document.querySelectorAll('#reader-mode [data-reader-mode]'))b.onclick=async()=>{
    const next=b.dataset.readerMode;readerMode=next;
    if(!state?.book||next===state.book.mode){syncMode();return;}
    await command({action:'set-mode',mode:next});
  };
  $('analyze-book').onclick=()=>command({action:'analyze'});
  $('book-file').onchange=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    if(file.size>800000){status('请选择 800KB 以内的 TXT / Markdown。');return;}
    try{$('book-name').value=file.name.replace(/\.(txt|md)$/i,'');$('book-draft').value=await file.text();status('文本已载入，点「保存文本」确认。');}catch(_){status('文件读取失败。');}
  };
  host?.onComposerTab?.(show);host?.onMediaState?.(render);
})();
