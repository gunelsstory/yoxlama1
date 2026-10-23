/** TicketFlow: Firestore-backed, admin-only ticket operations.
 * Existing Firestore collections remain tfOrders, tfEvents, tfReceipts and tfCheckins.
 * New ticket records: tickets/{ticketNumber}; template: ticketTemplates/global.
 * The client SDK is NOT an access-control boundary: deploy the accompanying rules.
 */
export function installTicketBridge({auth,store,ref,getDoc,setDoc,onSnapshot,collection,runTransaction}){
  const tickets=new Map();
  let stopTickets=null,stopTemplate=null;
  const docId=id=>{
    const value=String(id||'');
    if(!/^[A-Za-z0-9_-]{4,120}$/.test(value)) throw Error('Bilet/sifariş identifikatoru etibarsızdır.');
    return value;
  };
  const admin=async()=>{
    const uid=auth.currentUser?.uid;
    if(!uid)throw Error('Admin hesabına daxil olun.');
    const snap=await getDoc(ref('tfAdmins',uid));
    if(!snap.exists()||snap.data().active!==true)throw Error('Aktiv admin icazəsi yoxdur.');
    return uid;
  };
  const newToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
  const validOrder=o=>o?.status==='Təsdiqlənib'&&o?.paymentStatus==='Təsdiqlənib';
  const ticketIds=(order,id)=>{
    const qty=Number(order.qty);
    if(!Number.isSafeInteger(qty)||qty<1||qty>100)throw Error('Bilet sayı yanlışdır.');
    const old=Array.isArray(order.tickets)?order.tickets:[];
    if(old.length>0&&old.length!==qty)throw Error('Təsdiqlənmiş sifarişin bilet sayı uyğunsuzdur.');
    const ids=Array.from({length:qty},(_,i)=>docId(String(old[i]||`TK-${id}-${String(i+1).padStart(2,'0')}`)));
    if(new Set(ids).size!==ids.length)throw Error('Sifarişdə təkrarlanan bilet nömrələri var.');
    return ids;
  };
  const makeTicket=(o,orderId,number,event,i,used=false,usedAt=null)=>{
    const qty=Number(o.qty);
    return {
      ticketNumber:number,orderId,eventId:o.eventId,
      eventName:event?.name||o.eventName||'Tədbir',
      date:event?.date||o.eventDate||'',time:event?.time||o.eventTime||'',
      venue:event?.venue||o.venue||o.location||'',
      buyerName:o.name||o.customerName||'—',
      buyerUid:o.userId||o.uid||o.buyerUid||o.customerUid||o.ownerUid||null,
      unitPrice:Number(event?.price??(Number(o.amount||0)/qty)),
      seat:Array.isArray(o.seats)?String(o.seats[i]||''):String(o.seat||''),
      qrToken:newToken(),used,usedAt,usedBy:null,status:'active',
      createdAt:Date.now(),schemaVersion:2
    };
  };
  async function ensureOrderTickets(order,event={}){
    const uid=await admin();
    const orderId=docId(order?.id);
    const os=await getDoc(ref('tfOrders',orderId));
    if(!os.exists()||!validOrder(os.data()))throw Error('Təsdiqlənmiş sifariş tapılmadı: '+orderId);
    const ids=ticketIds(os.data(),orderId);
    let created=0;
    for(let i=0;i<ids.length;i++){
      const ticketNumber=ids[i];
      const made=await runTransaction(store,async tx=>{
        // Firestore transaction: read all relevant records before writing anything.
        const or=ref('tfOrders',orderId),tr=ref('tickets',ticketNumber),cr=ref('tfCheckins',ticketNumber);
        const [orderNow,ticketNow,checkinNow]=await Promise.all([tx.get(or),tx.get(tr),tx.get(cr)]);
        if(!orderNow.exists()||!validOrder(orderNow.data()))throw Error('Sifariş təsdiqi dəyişib.');
        const o=orderNow.data();
        const currentIds=ticketIds(o,orderId);
        if(currentIds[i]!==ticketNumber)throw Error('Sifariş biletlərinin identifikatorları dəyişib.');
        if(ticketNow.exists()){
          if(ticketNow.data().orderId!==orderId)throw Error('Bilet nömrəsi başqa sifarişə aiddir.');
          return false;
        }
        const existingCheckin=checkinNow.exists()?checkinNow.data():null;
        tx.set(tr,makeTicket(o,orderId,ticketNumber,event,i,!!existingCheckin,existingCheckin?.checkedAt||null));
        return true;
      });
      if(made)created++;
    }
    return created;
  }
  async function lookup(ticketNumber,qrToken=null){
    await admin();ticketNumber=docId(ticketNumber);
    const tr=await getDoc(ref('tickets',ticketNumber));
    if(!tr.exists())return null;
    const t=tr.data();
    if(t.status!=='active')throw Error('Bilet aktiv deyil.');
    if(qrToken!==null&&qrToken!==t.qrToken)throw Error('QR kodun təhlükəsizlik tokeni uyğun deyil.');
    const or=await getDoc(ref('tfOrders',docId(t.orderId)));
    if(!or.exists()||!validOrder(or.data()))throw Error('Sifariş təsdiqlənməyib.');
    const checkin=await getDoc(ref('tfCheckins',ticketNumber));
    return {...t,ticketNumber,id:ticketNumber,used:!!t.used||checkin.exists()};
  }
  async function checkin(ticketNumber,qrToken=null){
    const uid=await admin();ticketNumber=docId(ticketNumber);
    const tr=ref('tickets',ticketNumber);
    const before=await getDoc(tr);
    if(!before.exists())throw Error('Bilet tapılmadı.');
    const orderId=docId(before.data().orderId);
    await runTransaction(store,async tx=>{
      const or=ref('tfOrders',orderId),cr=ref('tfCheckins',ticketNumber);
      const [ticket,order,legacy]=await Promise.all([tx.get(tr),tx.get(or),tx.get(cr)]);
      if(!ticket.exists())throw Error('Bilet tapılmadı.');
      const t=ticket.data();
      if(t.orderId!==orderId||t.status!=='active')throw Error('Bilet aktiv deyil.');
      if(qrToken!==null&&t.qrToken!==qrToken)throw Error('QR kod uyğun deyil.');
      if(t.used||legacy.exists())throw Error('Bu bilet artıq istifadə olunub.');
      if(!order.exists()||!validOrder(order.data()))throw Error('Sifariş təsdiqlənməyib.');
      const now=Date.now();
      tx.update(tr,{used:true,usedAt:now,usedBy:uid});
      // Keeps compatibility with the admin panel's pre-existing tfCheckins collection.
      tx.set(cr,{ticket:ticketNumber,orderId,checkedAt:now,by:uid});
    });
    return true;
  }
  async function saveTemplate(imageDataURL){
    await admin();
    if(typeof imageDataURL!=='string'||!imageDataURL.startsWith('data:image/jpeg;base64,')||imageDataURL.length>700000)
      throw Error('Bilet şablonunun formatı və ya həcmi düzgün deyil.');
    await setDoc(ref('ticketTemplates','global'),{imageDataURL,updatedAt:Date.now()});
  }
  function start(){
    stop();
    stopTickets=onSnapshot(collection(store,'tickets'),snap=>{
      tickets.clear();snap.forEach(d=>tickets.set(d.id,{...d.data(),id:d.id}));
      window.TFTicketAdmin?.setBridgeDataChanged?.();
    },err=>{window.toast?.('Biletlər oxunmadı: '+err.message);console.error(err)});
    stopTemplate=onSnapshot(ref('ticketTemplates','global'),snap=>{
      if(snap.exists())window.TFTicketAdmin?.templateLoaded?.(snap.data());
    },err=>console.error('Bilet şablonu oxunmadı:',err));
  }
  function stop(){
    stopTickets?.();stopTemplate?.();stopTickets=null;stopTemplate=null;
    tickets.clear();window.TFTicketAdmin?.setBridgeDataChanged?.();
  }
  const api={tickets,ensureOrderTickets,lookup,checkin,saveTemplate,start,stop};
  window.TFTicketBridge=api;
  return api;
}
