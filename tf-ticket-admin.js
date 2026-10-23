/* TicketFlow admin ticket experience, runs with existing Firebase module via TFTicketBridge. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const htmlEscape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { ticket: null, qrReader: null, scannerOn: false, scannerBusy:false, template: 'assets/ticket.jpg', templateObjectURL: null, confirmedResult:null };
  const bridge = () => window.TFTicketBridge;
  async function picture(src){
    const im=new Image();im.decoding='async';im.src=src;
    await im.decode();return im;
  }
  const notice = text => window.toast ? window.toast(text) : alert(text);
  const dataOrder = id => (window.TFTicketModel?.()?.orders || []).find(o=>o.id === id);
  const dataEvent = id => (window.TFTicketModel?.()?.events || []).find(e=>e.id === id);
  const idFor = t => t.ticketNumber || t.id;
  const fm = v => String(v??'—');
  const authReady = () => document.body.classList.contains('authenticated');

  const buildTicketImage=(ticket,demo=false)=>window.TFTicketRenderer.render(ticket,{template:state.template,demo});
  const encode=ticket=>window.TFTicketRenderer.encode(ticket);
  function decode(text){
    const x=String(text||'').trim();
    const parts=x.split('|');
    if(parts.length===3&&parts[0]==='TF1'&&parts[1]&&parts[2])return {ticketNumber:parts[1],qrToken:parts[2],qr:true};
    if(/^[-\w]{4,120}$/.test(x))return {ticketNumber:x,qrToken:null,qr:false};
    throw Error('QR formatı tanınmadı.');
  }
  async function preview(ticket, demo=false){
    if(!ticket)throw Error('Bilet tapılmadı.');
    if(!demo&&!ticket.qrToken)throw Error('Bilet üçün təhlükəsiz QR kod yaradılmayıb.');
    const canvas=await buildTicketImage(ticket,demo);
    $('tfTicketCanvasBox').replaceChildren(canvas);
    state.ticket=ticket;
    $('tfTicketPreviewTitle').textContent=demo?'Bilet şablonu — nümunə':('Bilet · '+idFor(ticket));
    $('tfTicketPreviewCaption').textContent= demo ? 'Bu nümunə ilə giriş mümkün deyil.' : 'QR kod təsdiqlənmiş biletə bağlıdır.';
    $('tfTicketDownload').disabled=demo;
    $('tfTicketPreviewModal').classList.add('show');
  }
  async function downloadPreview(){
    const can=$('tfTicketCanvasBox').querySelector('canvas');if(!can)return;
    const blob=await new Promise(r=>can.toBlob(r,'image/png',.95));
    if(!blob)throw Error('Bilet şəklini yaratmaq mümkün olmadı.');
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
    a.download=(idFor(state.ticket)||'bilet').replace(/[^a-zA-Z0-9_-]/g,'-')+'.png';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function closePreview(){$('tfTicketPreviewModal').classList.remove('show');}

  function ticketList(){return Array.from(bridge()?.tickets?.values?.()||[])}
  function statusView(t) {return t.used ? '<span class="status expired">Giriş edilib</span>' : '<span class="status paid">Aktiv</span>'}
  function render(){
    const tbody=$('ticketsTable'); if(!tbody)return;
    const q=($('ticketSearch').value||'').toLowerCase();
    const arr=ticketList().filter(t=>[t.ticketNumber,t.orderId,t.eventName,t.buyerName].join(' ').toLowerCase().includes(q));
    tbody.innerHTML=arr.length?arr.map(t=>`<tr><td><b>${htmlEscape(t.ticketNumber)}</b></td><td>${htmlEscape(t.orderId||'')}</td><td>${htmlEscape(t.eventName||'')}</td><td>${htmlEscape(t.buyerName||'')}</td><td>${statusView(t)}</td><td><button class="linkbtn" data-ticket-preview="${htmlEscape(t.ticketNumber)}">Biletə bax</button>${t.used?'':` <button class="linkbtn" data-ticket-confirm="${htmlEscape(t.ticketNumber)}">Girişi təsdiqlə</button>`}</td></tr>`).join(''):
    '<tr><td colspan="6"><div class="empty">'+(bridge()?'Firebase-də uyğun bilet tapılmadı. Köhnə təsdiqlənmiş sifarişlər üçün “Biletləri sinxronlaşdır” düyməsini istifadə et.':'Firebase bilet modulu qoşulmayıb. tf-admin-cloud.js faylına inteqrasiya lazımdır.')+'</div></td></tr>';
    $('tfTicketTotal').textContent=String(ticketList().length);
    $('tfTicketEntered').textContent=String(ticketList().filter(x=>x.used).length);
    $('tfTicketAvailable').textContent=String(ticketList().filter(x=>!x.used).length);
    $('tfTicketBridgeStatus').textContent=bridge()?'Firestore ilə bağlıdır':'Firebase bilet bağlantısı gözlənilir';
  }
  function result(message,type='default',ticket=null){
    const el=$('tfTicketScanResult'); el.className='tf-scan-result '+type;el.textContent=message;
    state.confirmedResult=ticket;
    $('tfTicketCheckInBtn').hidden=!(ticket && !ticket.used);
    $('tfTicketCheckInBtn').disabled=!(ticket && !ticket.used);
  }
  async function lookup(raw){
    if(!bridge()) throw Error('Firebase bilet modulu qoşulmayıb.');
    const parsed=decode(raw);
    const t=await bridge().lookup(parsed.ticketNumber,parsed.qrToken);
    if(!t)throw Error('Bu nömrə ilə təsdiqlənmiş bilet tapılmadı.');
    if(t.used){result('Bu bilet artıq istifadə edilib: '+t.ticketNumber,'error',t);return;}
    result('Bilet etibarlıdır · '+t.eventName+' · '+t.buyerName+' · '+t.ticketNumber,'success',t);
  }
  async function confirmCheckin(ticket){
    if(!bridge())throw Error('Firebase bağlantısı yoxdur.');
    if(!confirm(ticket.ticketNumber+' nömrəli bilet üçün girişi təsdiqləyirsən?'))return;
    await bridge().checkin(ticket.ticketNumber,ticket.qrToken||null);
    result('Giriş təsdiqləndi: '+ticket.ticketNumber,'success');render();notice('Bilet istifadə olunmuş kimi işarələndi.');
  }
  async function scannerOff(){
    state.scannerOn=false;state.scannerBusy=false;
    try{await state.qrReader?.stop?.()}catch(e){}
    try{state.qrReader?.clear?.()}catch(e){}
    state.qrReader=null;
    $('tfTicketScanner').replaceChildren();$('tfScanStart').hidden=false;$('tfScanStop').hidden=true;
  }
  async function scannerOn(){
    if(!authReady())throw Error('Əvvəlcə admin hesabına daxil olun.');
    if(!window.Html5Qrcode) throw Error('Kamera skaneri yüklənmədi. İnternet bağlantısını yoxlayın.');
    await scannerOff();
    const reader = new window.Html5Qrcode('tfTicketScanner');
    state.qrReader=reader;state.scannerOn=true;
    await reader.start({facingMode:'environment'}, {fps:8,qrbox:{width:220,height:220}},async value=>{
      if(state.scannerBusy)return;state.scannerBusy=true;
      await scannerOff();
      try{await lookup(value)}catch(e){result(e.message,'error')}
    },()=>{});
    $('tfScanStart').hidden=true;$('tfScanStop').hidden=false;
  }

  async function syncApproved(){
    if(!bridge())throw Error('Firebase bilet bağlantısı yoxdur.');
    const orders=(window.TFTicketModel?.()?.orders||[]).filter(x=>x.status==='Təsdiqlənib');
    if(!orders.length){notice('Təsdiqlənmiş sifariş tapılmadı.');return}
    if(!confirm(orders.length+' təsdiqlənmiş sifariş üçün çatışmayan bilet sənədləri yaradılacaq. Davam edək?'))return;
    $('tfTicketSync').disabled=true;
    const errors=[];let added=0;
    try{
      for(const o of orders){
        try{added+=await bridge().ensureOrderTickets(o,dataEvent(o.eventId)||{});}catch(e){errors.push(o.id+': '+e.message)}
      }
      notice(added+' bilet yaradıldı.'+(errors.length?' '+errors.length+' sifarişdə xəta var.':''));
      if(errors.length)result(errors.slice(0,3).join(' | '),'error');
    } finally {$('tfTicketSync').disabled=false}
  }
  async function saveTemplate(){
    const input=$('tfTicketTemplateUpload');const file=input.files?.[0];
    if(!file)throw Error('Əvvəlcə şablon şəkli seçin.');
    if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>3*1024*1024)throw Error('JPG/PNG/WebP və maksimum 3 MB qəbul edilir.');
    const tmp=URL.createObjectURL(file);let newSrc;
    try{
      const pic=await picture(tmp);
      const c=document.createElement('canvas');c.width=829;c.height=1774;
      c.getContext('2d').drawImage(pic,0,0,c.width,c.height);
      newSrc=c.toDataURL('image/jpeg',.82);
      if(newSrc.length>700000)throw Error('Şablon Firestore üçün çox böyükdür.');
    }finally{URL.revokeObjectURL(tmp)}
    if(!bridge())throw Error('Firebase bilet modulu qoşulmayıb. Şablon saxlanılmadı.');
    await bridge().saveTemplate(newSrc);
    state.template=newSrc;$('tfTicketTemplateStatus').textContent='Şablon Firestore-da saxlanıldı.';
    notice('Bilet şablonu yeniləndi.');
  }
  function demoTicket(){
    const ev=(window.TFTicketModel?.()?.events||[])[0] || {};
    return {ticketNumber:'NÜMUNƏ-0001',eventName:ev.name||'Golden Autumn — The Magical Costume Ball',date:ev.date||'2026-10-25',time:ev.time||'15:00',venue:ev.venue||'Cactus Restoranı, Banket Zalı',buyerName:'Nümunə Alıcı',unitPrice:ev.price||25};
  }
  function bind(){
    $('tfTicketScanForm').addEventListener('submit',async e=>{e.preventDefault();try{await lookup($('tfTicketScanInput').value)}catch(err){result(err.message,'error')}});
    $('tfTicketCheckInBtn').addEventListener('click',async()=>{try{await confirmCheckin(state.confirmedResult)}catch(e){result(e.message,'error')}});
    $('tfScanStart').addEventListener('click',()=>scannerOn().catch(e=>{scannerOff();result(e.message,'error')}));
    $('tfScanStop').addEventListener('click',scannerOff);
    $('tfTicketSync').addEventListener('click',()=>syncApproved().catch(e=>notice(e.message)));
    $('tfTicketTemplateSave').addEventListener('click',()=>saveTemplate().catch(e=>notice(e.message)));
    $('tfTicketDemo').addEventListener('click',()=>preview(demoTicket(),true).catch(e=>notice(e.message)));
    $('tfTicketPreviewClose').addEventListener('click',closePreview);
    $('tfTicketPreviewClose2').addEventListener('click',closePreview);
    $('tfTicketPreviewModal').addEventListener('click',e=>{if(e.target===$('tfTicketPreviewModal'))closePreview()});
    $('tfTicketDownload').addEventListener('click',()=>downloadPreview().catch(e=>notice(e.message)));
    $('ticketSearch').addEventListener('input',render);
    document.addEventListener('click',e=>{
      const previewButton=e.target.closest('[data-ticket-preview]');
      if(previewButton){const t=bridge()?.tickets?.get(previewButton.dataset.ticketPreview);if(t)preview(t).catch(e=>notice(e.message));}
      const checkButton=e.target.closest('[data-ticket-confirm]');
      if(checkButton){const t=bridge()?.tickets?.get(checkButton.dataset.ticketConfirm);if(t)confirmCheckin(t).catch(e=>notice(e.message));}
    });
    document.querySelectorAll('.nav button[data-page]').forEach(btn=>btn.addEventListener('click',()=>{if(btn.dataset.page!=='tickets')scannerOff()}));
  }
  window.TFTicketAdmin={encode,decode,render,preview,lookup,scannerOff,
    setBridgeDataChanged:render,
    templateLoaded:data=>{if(data?.imageDataURL){state.template=data.imageDataURL;$('tfTicketTemplateStatus').textContent='Firestore şablonu aktivdir.';}},
    afterApproval:async(id)=>{
      if(!bridge())throw Error('Sifariş təsdiqləndi, lakin bilet modulu qoşulmayıb. Bilet hələ yaradılmadı.');
      const o=dataOrder(id);
      if(!o)throw Error('Bilet yaratmaq üçün sifariş məlumatları gözlənilir. “Biletləri sinxronlaşdır” düyməsindən istifadə edin.');
      return bridge().ensureOrderTickets(o,dataEvent(o.eventId)||{});
    }
  };
  bind();render();
})();
