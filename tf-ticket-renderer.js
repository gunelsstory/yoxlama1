/* Shared canvas renderer for admin and future user tickets. Requires qrcode.min.js. */
(function(){
'use strict';
  const fm=v=>String(v??'—');
  const idFor=t=>t.ticketNumber||t.id;
  const prettyDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?String(s).split('-').reverse().join('.'):fm(s);
  async function qrCanvas(value, size=250) {
    if (!window.QRCode) throw Error('QR kitabxanası yüklənməyib. İnternet bağlantısını yoxlayın.');
    const holder=document.createElement('div'); holder.style.cssText='position:fixed;left:-9999px;top:-9999px';
    document.body.append(holder);
    try {
      new window.QRCode(holder, {text:value, width:size, height:size,
        correctLevel:window.QRCode.CorrectLevel.M, colorDark:'#171827', colorLight:'#ffffff'});
      await new Promise(r=>setTimeout(r,60));
      let node=holder.querySelector('canvas');
      if (node && node.width) return node;
      const img=holder.querySelector('img');
      if (!img) throw Error('QR yaratmaq mümkün olmadı.');
      await img.decode();const c=document.createElement('canvas');c.width=size;c.height=size;
      c.getContext('2d').drawImage(img,0,0,size,size);return c;
    } finally {holder.remove()}
  }

  async function picture(src){
    const im=new Image();im.decoding='async';
    if (src.startsWith('http')) im.crossOrigin='anonymous';
    im.src=src;await im.decode();return im;
  }
  function fitText(ctx, content, x, y, maxWidth, fontSize=32, weight=700, align='left'){
    let size=fontSize;ctx.textAlign=align;
    do {ctx.font=`${weight} ${size}px Inter, Arial, sans-serif`; if(ctx.measureText(content).width<=maxWidth)break;size-=1;} while(size>=16);
    ctx.fillText(content,x,y);
  }
  function field(ctx,label,value,x,y,w, valueSize=25) {
    ctx.textAlign='left';ctx.fillStyle='#8b8290';ctx.font='700 17px Arial, sans-serif';ctx.fillText(label.toUpperCase(),x,y);
    ctx.fillStyle='#25202e';fitText(ctx, String(value||'—'),x,y+36,w,valueSize,700);
  }

  async function buildTicketImage(ticket, {template='assets/ticket.jpg',demo=false}={}){
    const im=await picture(template);
    const w=im.naturalWidth||829, h=im.naturalHeight||1774;
    const can=document.createElement('canvas');can.width=w;can.height=h;
    const c=can.getContext('2d');c.drawImage(im,0,0,w,h);
    const sx=w/829,sy=h/1774;
    c.save();c.scale(sx,sy);
    c.fillStyle='#241f2a';fitText(c,fm(ticket.eventName).toUpperCase(),414,278,690,36,800,'center');
    c.fillStyle='#7b7186';c.textAlign='center';c.font='17px Arial, sans-serif';c.fillText('ELEKTRON GİRİŞ BİLETİ',414,313);
    c.strokeStyle='#eee9ea';c.lineWidth=1.5;c.beginPath();c.moveTo(92,348);c.lineTo(735,348);c.stroke();
    field(c,'Tarix', prettyDate(ticket.date),95,400,270,26);
    field(c,'Saat', ticket.time||'—',439,400,290,26);
    field(c,'Məkan', ticket.venue||'—',95,500,635,24);
    field(c,'Alıcı',ticket.buyerName||'—',95,607,635,25);
    field(c,'Bilet nömrəsi', idFor(ticket)||'—',95,711,410,23);
    field(c,'Qiymət', Number(ticket.unitPrice||0).toFixed(2)+' ₼',550,711,185,24);
    const payload = demo?'DEMO-NOT-VALID':encode(ticket);
    const qr=await qrCanvas(payload,206);
    c.fillStyle='#fff';c.fillRect(296,781,237,237);
    c.drawImage(qr,311,796,206,206);
    c.fillStyle='#71677a';c.textAlign='center';c.font='16px Arial';c.fillText('Girişdə QR kodu təqdim edin',414,1051);
    c.fillStyle='#302b3a';c.textAlign='left';c.font='800 30px Arial';c.fillText('BİLETİNİZ HAZIRDIR',95,1385);
    c.font='700 20px Arial';c.fillText('Tədbir: '+fm(ticket.eventName),95,1440);
    c.font='18px Arial';c.fillText('Tarix: '+prettyDate(ticket.date)+'  •  Saat: '+fm(ticket.time),95,1483);
    c.fillText('Bilet: '+fm(idFor(ticket)),95,1526);
    c.font='18px Arial';c.fillText('Sifariş: '+fm(ticket.orderId),95,1565);
    if(ticket.seat) c.fillText('Sıra / yer: '+fm(ticket.seat),95,1601);
    c.font='17px Arial';c.fillText('QR kod yalnız bir dəfə giriş üçün keçərlidir.',95,1655);
    if(demo){c.save();c.translate(415,1010);c.rotate(-0.45);c.globalAlpha=.24;c.fillStyle='#c74455';c.font='bold 84px Arial';c.textAlign='center';c.fillText('NÜMUNƏ',0,0);c.restore()}
    c.restore();return can;
  }
  function encode(ticket) {
    if(!ticket?.ticketNumber || !ticket?.qrToken) throw Error('Biletin təhlükəsiz QR tokeni hələ yoxdur.');
    return 'TF1|'+ticket.ticketNumber+'|'+ticket.qrToken;
  }
window.TFTicketRenderer={render:buildTicketImage,encode};
})();
