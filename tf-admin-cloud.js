import {auth,store,ref,error,listen,applyImages,liveHolds,imageDoc,onAuthStateChanged,signInWithEmailAndPassword,signOut,doc,getDoc,setDoc,addDoc,updateDoc,deleteDoc,collection,onSnapshot,runTransaction} from './tf-core.js';
import {installTicketBridge} from './tf-ticket-bridge.js';

let user=null,authorized=false,unsubs=[];
const bridge=installTicketBridge({auth,store,ref,getDoc,setDoc,onSnapshot,collection,runTransaction});
const reset=()=>{
  for(const unsubscribe of unsubs)unsubscribe();unsubs=[];
  bridge.stop();
  db={events:[],orders:[],expenses:[],checkedInTickets:[]};
  renderAll();
};
function watch(){
  reset();
  for(const [c,key] of [['tfEvents','events'],['tfOrders','orders'],['tfExpenses','expenses']]){
    unsubs.push(listen(c,async rows=>{
      db[key]=rows;
      if(key==='events')await applyImages(rows,()=>renderAll());
      renderAll();
    },e=>toast(error(e))));
  }
  unsubs.push(listen('tfCheckins',rows=>{
    db.checkedInTickets=rows.map(x=>x.id);
    renderAll();
  }));
  bridge.start();
}
onAuthStateChanged(auth,async u=>{
  user=u;authorized=false;reset();
  document.body.classList.remove('authenticated');
  if(!u)return;
  try{
    const r=await getDoc(ref('tfAdmins',u.uid));
    if(!r.exists()||r.data().active!==true)throw Error('Bu hesabın admin icazəsi yoxdur. tfAdmins/{UID} active=true yaradın.');
    if(auth.currentUser?.uid!==u.uid)return;
    authorized=true;document.body.classList.add('authenticated');watch();
  }catch(e){
    const n=document.getElementById('loginError');n.textContent=error(e);n.style.display='block';
    await signOut(auth);
  }
});
const ensureAdmin=()=>{if(!authorized||!user)throw Error('Aktiv admin icazəsi yoxdur.');};
const makeId=()=> 'EV-'+crypto.randomUUID().slice(0,12).toUpperCase();
const ticketToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('');
const validId=s=>{
  s=String(s||'');if(!/^[A-Za-z0-9_-]{4,120}$/.test(s))throw Error('Sifariş və ya bilet ID-si yanlışdır.');return s;
};

window.TFAdmin={
  error,
  async login(email,password){await signInWithEmailAndPassword(auth,email,password)},
  async logout(){await signOut(auth)},
  async saveEvent(data,editId,form){
    ensureAdmin();
    const existing=db.events.find(x=>x.id===editId);
    if(!Number.isFinite(data.price)||data.price<0||!Number.isInteger(data.capacity)||data.capacity<1)throw Error('Qiymət və limit düzgün deyil');
    if(existing&&data.capacity<Number(existing.sold||0)+Object.values(liveHolds(existing)).reduce((a,h)=>a+Number(h.qty),0))throw Error('Bilet limiti rezervasiyalardan az ola bilməz');
    const record={name:String(data.name||'').trim(),date:data.date,time:data.time,venue:data.venue,price:data.price,capacity:data.capacity,status:data.status,featured:data.featured,description:data.description||'',category:existing?.category||'Əyləncə',sold:existing?.sold||0,holds:existing?.holds||{},createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};
    const id=editId||makeId();
    for(const [input,k] of [['posterFile','posterImage'],['detailFile','detailImage'],['heroFile','heroImage'],['specialFile','specialImage']]){
      const file=form.elements[input]?.files?.[0];
      if(file)record[k+'Id']=await imageDoc(file,k,id);
      else if(existing?.[k+'Id'])record[k+'Id']=existing[k+'Id'];
    }
    if(data.featured==='yes')for(const e of db.events.filter(x=>x.id!==id&&x.featured==='yes'))await updateDoc(ref('tfEvents',e.id),{featured:'no'});
    await setDoc(ref('tfEvents',id),record);
  },
  async approve(id){
    ensureAdmin();id=validId(id);
    // Approval + seat count + all QR ticket records are created atomically.
    // A failed ticket write rolls the order approval back as well.
    return runTransaction(store,async tx=>{
      const or=ref('tfOrders',id),rr=ref('tfReceipts',id);
      const os=await tx.get(or);
      if(!os.exists())throw Error('Sifariş tapılmadı');
      const o=os.data();
      const er=ref('tfEvents',o.eventId);
      const [es,rs]=await Promise.all([tx.get(er),tx.get(rr)]);
      if(!es.exists())throw Error('Tədbir tapılmadı');
      if(!rs.exists())throw Error('Ödəniş qəbzi yoxdur');
      if(o.status!=='Gözləyir'||Number(o.expiresAt||0)<Date.now())throw Error('Rezervasiya müddəti bitib və ya artıq yoxlanıb');
      if(!o.receiptId)throw Error('Qəbz hələ göndərilməyib');
      const qty=Number(o.qty),e=es.data();
      if(!Number.isSafeInteger(qty)||qty<1||qty>100)throw Error('Bilet sayı yanlışdır');
      if(Number(e.sold||0)+qty>Number(e.capacity))throw Error('Yerlər doludur');
      const ids=Array.from({length:qty},(_,i)=>validId('TK-'+id+'-'+String(i+1).padStart(2,'0')));
      const ticketRefs=ids.map(n=>ref('tickets',n));
      const existing=await Promise.all(ticketRefs.map(t=>tx.get(t)));
      if(existing.some(t=>t.exists()))throw Error('Bu sifariş üçün bilet artıq mövcuddur. Əməliyyat dayandırıldı.');
      // No reads beyond this point (Firestore transaction requirement).
      const holds={...e.holds};delete holds[id];
      const now=Date.now(),unitPrice=Number(e.price??Number(o.amount||0)/qty);
      const buyerUid=o.userId||o.uid||o.buyerUid||o.customerUid||o.ownerUid||null;
      const buyerName=o.name||o.customerName||'—';
      ticketRefs.forEach((tr,i)=>tx.set(tr,{
        ticketNumber:ids[i],orderId:id,eventId:o.eventId,
        eventName:e.name||o.eventName||'Tədbir',date:e.date||'',time:e.time||'',venue:e.venue||'',
        buyerName,buyerUid,unitPrice,
        seat:Array.isArray(o.seats)?String(o.seats[i]||''):String(o.seat||''),
        qrToken:ticketToken(),status:'active',used:false,usedAt:null,usedBy:null,
        createdAt:now,schemaVersion:2
      }));
      tx.update(er,{sold:Number(e.sold||0)+qty,holds});
      tx.update(or,{status:'Təsdiqlənib',paymentStatus:'Təsdiqlənib',tickets:ids,approvedAt:now,approvedBy:user.uid});
      return ids;
    });
  },
  async reject(id){
    ensureAdmin();id=validId(id);
    await runTransaction(store,async tx=>{
      const or=ref('tfOrders',id),os=await tx.get(or);
      if(!os.exists()||os.data().status!=='Gözləyir')throw Error('Sifariş artıq yoxlanıb');
      const o=os.data(),er=ref('tfEvents',o.eventId),es=await tx.get(er);
      if(es.exists()){const holds={...es.data().holds};delete holds[id];tx.update(er,{holds});}
      tx.update(or,{status:'Rədd edilib',paymentStatus:'Rədd edilib',reviewedAt:Date.now()});
    });
  },
  async addExpense(data){ensureAdmin();await addDoc(collection(store,'tfExpenses'),{name:data.name,amount:Number(data.amount),eventId:data.eventId||'',date:data.date,createdAt:Date.now()})},
  async deleteExpense(id){ensureAdmin();await deleteDoc(ref('tfExpenses',id))},
  async checkin(ticket){ensureAdmin();return bridge.checkin(ticket)},
  async card(cardNumber,cardHolder){ensureAdmin();await setDoc(ref('tfSettings','payment'),{cardNumber,cardHolder,updatedAt:Date.now()})}
};
window.openReceiptViewer=async id=>{
  const o=db.orders.find(x=>x.id===id);if(!o)return;
  document.getElementById('receiptModalTitle').textContent='Qəbz · '+id;
  const body=document.getElementById('receiptModalBody');body.textContent='Qəbz yüklənir…';
  document.getElementById('receiptModal').classList.add('show');
  try{
    const s=await getDoc(ref('tfReceipts',id));
    if(!s.exists())throw Error('Qəbz göndərilməyib');
    const data=String(s.data().data||'');
    if(!/^data:(?:image\/(?:png|jpeg|webp)|application\/pdf);base64,/.test(data))throw Error('Qəbz formatı dəstəklənmir');
    body.innerHTML=`<div class="receipt-meta"><b>Müştəri:</b> ${esc(o.name)}<br><b>Məbləğ:</b> ${money(o.amount)}<br><b>Tədbir:</b> ${eventCell(o.eventId)}</div>`+
       (data.startsWith('data:application/pdf')?`<a class="secondary" href="${data}" target="_blank" rel="noopener">PDF qəbzi aç</a>`:`<div class="receipt-img-wrap"><img alt="Ödəniş qəbzi" src="${data}"></div>`);
  }catch(e){body.textContent=error(e)}
};
