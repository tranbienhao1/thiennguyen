'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NocturneMetadataUI = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function create({getElement:$, library, client, formatTime = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2,'0')}`} = {}) {
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const session = {track:null,kind:'track',generation:0,history:[],locked:false,parentKind:''};
    const safeUrl = (value, hosts=[]) => { try { const u=new URL(value); return u.protocol==='https:' && hosts.some(h=>u.hostname===h || u.hostname.endsWith(`.${h}`)) ? u.href : ''; } catch(error) { return ''; } };
    const artistName = entity => {
      const credits=entity && (entity['artist-credit'] || entity['artist-credit-phrase']);
      return Array.isArray(credits) ? credits.map(c=>c.name || c.artist && c.artist.name || '').filter(Boolean).join('') : typeof credits==='string' ? credits : '';
    };
    const artistLinks = credits => Array.isArray(credits) ? credits.map(c=> {
      const a=c.artist;
      return a && a.id ? `<button type="button" class="metadata-inline-link" data-metadata-follow="artist" data-metadata-id="${esc(a.id)}" data-metadata-title="${esc(a.name || c.name)}">${esc(c.name || a.name)}</button>${esc(c.joinphrase || '')}` : esc(c.name || '');
    }).join('') : esc(artistName({'artist-credit':credits}));
    const setTabs = () => document.querySelectorAll('[data-metadata-kind]').forEach(b=>{
      const active=b.dataset.metadataKind===session.kind; b.classList.toggle('is-active',active); b.setAttribute('aria-selected',String(active));
    });
    const resetDetail = () => {
      $('metadata-results').classList.remove('hidden'); $('metadata-detail').classList.add('hidden');
      $('metadata-back').classList.add('hidden'); $('metadata-back').classList.remove('inline-flex');
    };
    const coverUrl = value => safeUrl(value,['coverartarchive.org','archive.org']);
    const summary = (kind,item) => {
      if(kind==='artist') return [item.type,item.country,item['life-span'] && [item['life-span'].begin,item['life-span'].end].filter(Boolean).join(' – ')].filter(Boolean).join(' · ');
      const artist=artistName(item), release=(item.releases || [])[0];
      return (kind==='album' ? [artist,item.date,item.country,item.status] : [artist,release && release.title,item['first-release-date'] || release && release.date]).filter(Boolean).join(' · ');
    };
    async function search() {
      if(!session.track || session.locked)return;
      const generation=++session.generation, kind=session.kind, query=$('metadata-query').value.trim();
      resetDetail(); $('metadata-results').replaceChildren();
      $('metadata-status').textContent=`Đang tìm ${kind==='track'?'bài hát':kind==='album'?'album':'nghệ sĩ'} trên MusicBrainz…`; $('metadata-status').classList.remove('hidden');
      try {
        const results=await client.search(kind,library.trackMetadata(session.track),query);
        if(generation!==session.generation)return;
        $('metadata-status').textContent=results.length?`${results.length} kết quả · chọn một mục để xem chi tiết`:'Không tìm thấy kết quả. Hãy thử đổi từ khóa hoặc tra theo tên nghệ sĩ/album.';
        $('metadata-results').innerHTML=results.map((item,index)=>`<button type="button" class="metadata-result" data-result="${index}"><span class="metadata-result-art">${coverUrl(item.cover) ? `<img src="${esc(coverUrl(item.cover))}" alt="" loading="lazy">` : '♫'}</span><span class="min-w-0"><span class="block truncate text-sm text-zinc-100">${esc(item.title || item.name || 'Không có tiêu đề')}</span><span class="mt-1 block truncate text-[11px] text-zinc-500">${esc(summary(kind,item) || item.disambiguation || '')}</span></span><span class="text-right text-[10px] text-zinc-600">${Number.isFinite(Number(item.score))?`${Number(item.score)}%`:'›'}<span class="block">›</span></span></button>`).join('');
        $('metadata-results').querySelectorAll('[data-result]').forEach(b=>b.addEventListener('click',()=>detail(kind,results[Number(b.dataset.result)])));
      } catch(error) { if(generation===session.generation)$('metadata-status').textContent=error.message || 'Không thể tra cứu dữ liệu lúc này.'; }
    }
    const source = (kind,id,label='MusicBrainz ↗')=>`<a class="metadata-source-link" href="https://musicbrainz.org/${kind}/${esc(id)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    const links = relations=>relations.map(r=>{
      const href=safeUrl(r && r.url && r.url.resource,['wikipedia.org','wikidata.org','musicbrainz.org','allmusic.com','discogs.com']);
      return href?`<a class="metadata-source-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(r.type || 'Tham khảo')} ↗</a>`:'';
    }).filter(Boolean).join('');
    async function detail(kind,item) {
      if(!item || !item.id)return;
      const generation=++session.generation;
      session.currentItem=item;
      session.locked=session.history.length>0;
      $('metadata-results').classList.add('hidden'); $('metadata-detail').classList.remove('hidden'); $('metadata-back').classList.remove('hidden'); $('metadata-back').classList.add('inline-flex');
      $('metadata-detail').innerHTML='<p>Đang tải thông tin chi tiết…</p>'; $('metadata-status').textContent='Đang tải credits, bài hát và bìa nếu có…'; $('metadata-status').classList.remove('hidden');
      try {
        const entity=await client.details(kind,item.id); if(generation!==session.generation || !entity)return;
        let cover=null; if(kind==='album')try{cover=await client.coverArt(entity.id);}catch(error){console.info('Album artwork unavailable:',error.message);}
        if(generation!==session.generation)return;
        const title=entity.title || entity.name || item.title || item.name || 'Thông tin', credits=entity['artist-credit'], artist=artistName(entity)||artistName(item);
        $('metadata-title').textContent=title;
        let body='';
        if(kind==='album') {
          const media=entity.media || [], tracks=media.flatMap(d=> (d.tracks || []).map(t=>({...t,disc:d.position || 1})));
          const labels=(entity['label-info'] || []).map(x=>[x.label && x.label.name,x['catalog-number']].filter(Boolean).join(' · ')).filter(Boolean);
          const people=[...new Map((entity.relations || []).filter(r=>r.artist && r.type).map(r=>[`${r.type}:${r.artist.id}`,{role:r.type,artist:r.artist}])).values()];
          const coverUrl=cover && safeUrl(cover.thumbnail,['coverartarchive.org','archive.org']);
          const art=coverUrl ? `<img src="${esc(coverUrl)}" alt="Bìa ${esc(title)}" loading="lazy">` : '<div class="grid h-full place-items-center text-5xl text-sky-100/60">♫</div>';
          body=`<div class="grid gap-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-start"><div class="metadata-detail-art sm:w-[200px]">${art}</div><div><h3 class="!mt-0 text-2xl">${esc(title)}</h3><p>${credits ? artistLinks(credits) : esc(artist || 'Nghệ sĩ chưa rõ')}</p><p>${esc([entity.date,entity.country,entity.status,entity.disambiguation].filter(Boolean).join(' · '))}</p><p>${esc(labels.join(' · '))}</p><p>${tracks.length ? `${tracks.length} bài · ${media.length} đĩa` : ''}</p>${source('release',entity.id)}${cover && safeUrl(cover.url,['coverartarchive.org','archive.org']) ? `<a class="metadata-source-link" href="${esc(safeUrl(cover.url,['coverartarchive.org','archive.org']))}" target="_blank" rel="noopener noreferrer">Bìa gốc ↗</a>` : ''}</div></div>${people.length ? `<h3>Credits</h3>${people.map(p=>`<div class="metadata-credit"><span class="text-zinc-500">${esc(p.role)}</span><span>${artistLinks([{name:p.artist.name,artist:p.artist}])}</span></div>`).join('')}` : ''}${tracks.length ? `<h3>Danh sách bài hát</h3>${tracks.map(t=>`<div class="metadata-track"><span class="text-zinc-600">${t.disc>1?`${t.disc}.`:''}${esc(t.number || t.position || '')}</span><span>${esc(t.title || t.recording && t.recording.title || '')}</span><span class="text-zinc-500">${t.length ? esc(formatTime(t.length/1000)) : ''}</span></div>`).join('')}` : '<h3>Danh sách bài hát</h3><p>MusicBrainz chưa có danh sách bài hát cho phiên bản này.</p>'}`;
        } else if(kind==='artist') {
          const life=entity['life-span'] || {}, relations=entity.relations || [];
          const wiki=relations.find(r=>r.type==='wikipedia' && r.url && r.url.resource) || relations.find(r=>r.url && /wikipedia\.org\/wiki\//i.test(r.url.resource || ''));
          let bio=null; if(wiki)try{bio=await client.wikipediaSummary(wiki.url.resource);}catch(error){console.info('Artist biography unavailable:',error.message);}
          if(generation!==session.generation)return;
          const groups=entity['release-groups'] || [], image=bio && safeUrl(bio.thumbnail,['wikimedia.org']);
          body=`${image?`<div class="metadata-detail-art mb-5"><img src="${esc(image)}" alt="${esc(title)}" loading="lazy"></div>`:''}<h3 class="!mt-0 text-2xl">${esc(title)}</h3><p>${esc([entity.type,entity.area && entity.area.name,life.begin && `Thành lập/sinh: ${life.begin}`,life.end && `Kết thúc: ${life.end}`].filter(Boolean).join(' · '))}</p>${bio?`<h3>Tiểu sử</h3><p>${esc(bio.extract)}</p><a class="metadata-source-link" href="${esc(safeUrl(bio.page,['wikipedia.org']))}" target="_blank" rel="noopener noreferrer">Đọc thêm trên Wikipedia ↗</a>`:'<p>Chưa có liên kết tiểu sử Wikipedia được xác nhận cho nghệ sĩ này.</p>'}${source('artist',entity.id)}${links(relations)}${groups.length?`<h3>Album / đĩa nhạc</h3>${groups.slice(0,30).map(g=>`<div class="metadata-credit"><span class="text-zinc-500">${esc(g['primary-type'] || 'Release')}</span><span>${esc(g.title || '')}${g['first-release-date']?` · ${esc(g['first-release-date'])}`:''}</span></div>`).join('')}`:''}`;
        } else {
          const releases=entity.releases || [], relations=(entity.relations || []).filter(r=>r.artist && r.type).slice(0,24);
          body=`<h3 class="!mt-0 text-2xl">${esc(title)}</h3><p>${credits ? artistLinks(credits) : esc(artist || 'Nghệ sĩ chưa rõ')}</p><p>${esc([entity['first-release-date'] && `Phát hành lần đầu: ${entity['first-release-date']}`,entity.length && `Thời lượng: ${formatTime(entity.length/1000)}`,entity.disambiguation].filter(Boolean).join(' · '))}</p>${source('recording',entity.id)}${releases.length?`<h3>Album / bản phát hành</h3>${releases.slice(0,20).map(r=>`<div class="metadata-credit"><span class="text-zinc-500">${esc(r.date || '')}</span><span>${r.id ? `<button type="button" class="metadata-inline-link" data-metadata-follow="album" data-metadata-id="${esc(r.id)}" data-metadata-title="${esc(r.title || '')}">${esc(r.title || '')}</button>` : esc(r.title || '')}</span></div>`).join('')}`:''}${relations.length?`<h3>Credits & cộng tác</h3>${relations.map(r=>`<div class="metadata-credit"><span class="text-zinc-500">${esc(r.type)}</span><span>${artistLinks([{name:r.artist.name,artist:r.artist}])}</span></div>`).join('')}`:'<p>Credits bổ sung chưa có trong dữ liệu mở cho bản ghi này.</p>'}`;
        }
        if(generation!==session.generation)return;
        $('metadata-detail').innerHTML=body;
        $('metadata-back').textContent=session.history.length ? '← Quay lại' : '← Kết quả';
      $('metadata-detail').querySelectorAll('[data-metadata-follow]').forEach(button=>button.addEventListener('click',()=>{
          const related={id:button.dataset.metadataId,name:button.dataset.metadataTitle || button.textContent.trim()};
          if(!related.id)return;
          const nextKind=button.dataset.metadataFollow;
          session.history.push({kind:session.kind,item:session.currentItem,title:$('metadata-title').textContent,subtitle:$('metadata-subtitle').textContent});
          session.locked=true;
          document.querySelectorAll('[data-metadata-kind]').forEach(tab=>{tab.disabled=true;});
          $('metadata-tabs').classList.add('hidden');
          $('metadata-query').placeholder='';
          session.kind=nextKind; $('metadata-query').value=''; setTabs(); detail(nextKind,related);
        }));
        $('metadata-status').classList.add('hidden');
        $('metadata-title').textContent=title;
        $('metadata-subtitle').textContent=kind==='album'?`${artist}${entity.date?` · ${entity.date}`:''}`:kind==='artist'?[entity.type,entity.area && entity.area.name].filter(Boolean).join(' · '):artist;
      } catch(error) {
        if(generation!==session.generation)return;
        $('metadata-detail').innerHTML=`<p>${esc(error.message || 'Không thể tải chi tiết.')}</p>`;
        $('metadata-status').classList.add('hidden');
      }
    }
    function open(track) {
      if(!track)return;
      session.track=track; session.kind='track'; session.locked=false; session.history=[]; session.currentItem=null;
      document.querySelectorAll('[data-metadata-kind]').forEach(button=>{button.disabled=false;});
      $('metadata-tabs').classList.remove('hidden');
      $('metadata-query').placeholder='Tìm tên khác hoặc phiên bản...';
      const info=library.trackMetadata(track);
      $('metadata-back').textContent='← Kết quả';
      $('metadata-title').textContent=info.title;
      $('metadata-subtitle').textContent=`${info.artist} · ${info.album}`;
      $('metadata-query').value=''; $('metadata-modal').classList.remove('hidden'); $('metadata-modal').classList.add('flex');
      document.body.classList.add('metadata-open'); setTabs(); search();
    }
    function close() {
      ++session.generation; session.track=null; session.locked=false; session.history=[]; session.currentItem=null;
      document.querySelectorAll('[data-metadata-kind]').forEach(button=>{button.disabled=false;});
      $('metadata-tabs').classList.remove('hidden');
      $('metadata-modal').classList.add('hidden'); $('metadata-modal').classList.remove('flex');
      document.body.classList.remove('metadata-open');
    }
    $('metadata-close').addEventListener('click',close);
    $('metadata-modal').addEventListener('click',event=>{if(event.target===$('metadata-modal'))close();});
    $('metadata-back').addEventListener('click',()=>{
      const previous=session.history.pop();
      if(!previous){session.locked=false;search();return;}
      session.locked=session.history.length>0;
      $('metadata-back').textContent=session.locked ? '← Quay lại' : '← Kết quả';
      document.querySelectorAll('[data-metadata-kind]').forEach(tab=>{tab.disabled=session.locked;});
      $('metadata-tabs').classList.toggle('hidden',session.locked);
      $('metadata-query').value=''; $('metadata-query').placeholder=session.locked?'':'Tìm tên khác hoặc phiên bản...';
      session.kind=previous.kind; setTabs();
      $('metadata-title').textContent=previous.title; $('metadata-subtitle').textContent=previous.subtitle;
      session.currentItem=previous.item;
      if(session.locked)detail(previous.kind,previous.item);else search();
    });
    $('metadata-search-button').addEventListener('click',search);
    $('metadata-query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();search();}});
    document.querySelectorAll('[data-metadata-kind]').forEach(button=>button.addEventListener('click',()=>{
      if(session.kind===button.dataset.metadataKind)return;
      session.kind=button.dataset.metadataKind; $('metadata-query').value=''; setTabs(); search();
    }));
    document.addEventListener('keydown',event=>{if(event.key==='Escape' && !$('metadata-modal').classList.contains('hidden'))close();});
    return {open,close,search,detail};
  }
  return {create};
});
