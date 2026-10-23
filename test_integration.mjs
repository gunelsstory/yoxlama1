/* Offline mocked-Firestore tests. No real Firebase connection. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const dir=new URL('./',import.meta.url);
const bridgeModule=fs.readFileSync(new URL('./tf-ticket-bridge.js',dir),'utf8');
const bridgeSource=bridgeModule.replace('export function installTicketBridge','function installTicketBridge')+'\n globalThis.installTicketBridge=installTicketBridge;';
const original=fs.readFileSync(new URL('./tf-admin-cloud.js',dir),'utf8');
const cloudSource=original.replace(/^import [^\n]*\n/gm,'');
const data=new Map();
const key=r=>r.c+'/'+r.i;
const ref=(c,i)=>({c,i});
const snap=(r,m=data)=>({id:r.i,ref:r,exists:()=>m.has(key(r)),data:()=>structuredClone(m.get(key(r)))});
const getDoc=async r=>snap(r);
const getAll=async r=>[...data].filter(([k])=>k.startsWith(r+'/'));
let writes=0;
const runTransaction=async (_,cb)=>{
  // Simplified atomic apply; enforces Firestore's reads-before-writes rule.
  const staged=[];let hasWritten=false;
  const tx={
    get:async r=>{assert(!hasWritten,'Cannot read after write in Firestore transaction');return snap(r)},
    set:(r,v)=>{hasWritten=true;staged.push({r,v,merge:false})},
    update:(r,v)=>{hasWritten=true;staged.push({r,v,merge:true})}
  };
  const result=await cb(tx);
  for(const w of staged){data.set(key(w.r),w.merge?{...(data.get(key(w.r))||{}),...w.v}:w.v);writes++}
  return result;
};
let onAuth;
const auth={currentUser:{uid:'admin1'}};
let context;
const fake={
  auth,store:{},ref,error:e=>e?.message||String(e),
  listen:()=>()=>{},applyImages:async()=>{},liveHolds:()=>({}),imageDoc:async()=>'',
  onAuthStateChanged:(a,cb)=>{onAuth=cb;return()=>{}},
  signInWithEmailAndPassword:async()=>{},signOut:async()=>{},
  doc:ref,getDoc,setDoc:async(r,v)=>data.set(key(r),v),
  addDoc:async()=>{},updateDoc:async()=>{},deleteDoc:async()=>{},
  collection:(_,name)=>name,onSnapshot:(r,cb)=>()=>{},runTransaction,
  crypto,db:{events:[],orders:[],expenses:[],checkedInTickets:[]},
  renderAll:()=>{},toast:()=>{},esc:s=>s,money:x=>String(x),eventCell:s=>s,
  document:{body:{classList:{add:()=>{},remove:()=>{}}},getElementById:()=>({style:{}})},
  console,Date,Number,String,Array,Object,Error,Promise,JSON,Map,Uint8Array,
};
context=vm.createContext(fake);
vm.runInContext('globalThis.window=globalThis;'+bridgeSource,context);
vm.runInContext(cloudSource,context);
const orderId='TF-TEST-2001',eId='EV-TEST-1';
data.set('tfAdmins/admin1',{active:true});
data.set('tfEvents/'+eId,{name:'Golden Autumn',date:'2026-11-08',time:'15:00',venue:'Cactus',price:25,capacity:5,sold:0,holds:{[orderId]:{qty:2}}});
data.set('tfReceipts/'+orderId,{data:'data:image/png;base64,...'});
data.set('tfOrders/'+orderId,{id:orderId,eventId:eId,qty:2,name:'Aysel',userId:'buyer-1',amount:50,receiptId:orderId,status:'Gözləyir',paymentStatus:'Gözləyir',expiresAt:Date.now()+600000});
await onAuth(auth.currentUser);
await new Promise(r=>setTimeout(r,0));
const api=context.TFAdmin;
const ids=await api.approve(orderId);
assert.equal(ids.length,2);
assert.equal(data.get('tfOrders/'+orderId).status,'Təsdiqlənib');
assert.equal(data.get('tfEvents/'+eId).sold,2);
let t1=data.get('tickets/'+ids[0]);let t2=data.get('tickets/'+ids[1]);
assert(t1.qrToken.length===48&&t2.qrToken!==t1.qrToken);
assert.equal(t1.buyerUid,'buyer-1');
const bridge=context.TFTicketBridge;
assert.equal((await bridge.lookup(ids[0],t1.qrToken)).used,false);
await assert.rejects(bridge.lookup(ids[0],'fake'),/tokeni/);
assert.equal(await bridge.ensureOrderTickets({id:orderId},data.get('tfEvents/'+eId)),0);
await assert.rejects(api.approve(orderId),/artıq yoxlanıb/);
await bridge.checkin(ids[0],t1.qrToken);
assert.equal(data.get('tickets/'+ids[0]).used,true);
assert(data.has('tfCheckins/'+ids[0]));
await assert.rejects(bridge.checkin(ids[0],t1.qrToken),/artıq istifadə/);
assert.equal((await bridge.lookup(ids[0],t1.qrToken)).used,true);
// Missing receipt must roll back.
let noReceipt='TF-NO-REC-1';
data.set('tfOrders/'+noReceipt,{id:noReceipt,eventId:eId,qty:1,name:'X',amount:25,receiptId:noReceipt,status:'Gözləyir',expiresAt:Date.now()+600000});
await assert.rejects(api.approve(noReceipt),/qəbzi yoxdur/);
assert.equal(data.get('tfOrders/'+noReceipt).status,'Gözləyir');
// Overcapacity must roll back.
const fullId='TF-FULL-1';
data.set('tfReceipts/'+fullId,{});
data.set('tfOrders/'+fullId,{id:fullId,eventId:eId,qty:4,name:'Y',amount:100,receiptId:fullId,status:'Gözləyir',expiresAt:Date.now()+600000});
await assert.rejects(api.approve(fullId),/doludur/);
assert.equal(data.get('tfEvents/'+eId).sold,2);
// Legacy already-used ticket should be backfilled as used.
const legacyId='TF-LEGACY-1',legacyTicket='TK-TF-LEGACY-1-01';
data.set('tfOrders/'+legacyId,{id:legacyId,eventId:eId,qty:1,tickets:[legacyTicket],name:'Old',status:'Təsdiqlənib',paymentStatus:'Təsdiqlənib'});
data.set('tfCheckins/'+legacyTicket,{checkedAt:12345});
assert.equal(await bridge.ensureOrderTickets({id:legacyId},data.get('tfEvents/'+eId)),1);
assert.equal(data.get('tickets/'+legacyTicket).used,true);
console.log(JSON.stringify({pass:true,ordersApproved:1,ticketIds:ids,tokensUnique:true,duplicateBlocked:true,rollbackOnMissingReceipt:true,rollbackOnCapacity:true,legacyCheckinPreserved:true,writeCount:writes}));
