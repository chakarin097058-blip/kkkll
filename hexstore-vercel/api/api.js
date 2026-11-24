const c=require('crypto');
const U=process.env.KV_REST_API_URL||process.env.UPSTASH_REDIS_REST_URL,K=process.env.KV_REST_API_TOKEN||process.env.UPSTASH_REDIS_REST_TOKEN;
const R=async(...a)=>(await(await fetch(U,{method:'POST',headers:{Authorization:'Bearer '+K},body:JSON.stringify(a)})).json()).result;
const G=async(k,d)=>{const v=await R('GET',k);return v?JSON.parse(v):d},S=(k,v)=>R('SET',k,JSON.stringify(v));
const H=(p,s)=>c.scryptSync(String(p),s,32).toString('hex');
const DS={title:'HEX PRODUCT',sub:'ร้านไอเทมและโค้ดเกม เติมคอยน์แล้วซื้อได้ทันที รับสินค้าภายใน 24 ชม.',ann:'เติมคอยน์ผ่าน QR แล้วกดซื้อได้เลย • ส่งสินค้าภายใน 24 ชม. • บริการตลอด 24 ชั่วโมง',pp:'',contact:'LINE: -'};
const DP=[{id:1,name:'ตัวอย่างสินค้า A',price:99,stock:10,cat:'โค้ด',em:'🔑',img:''},{id:2,name:'ตัวอย่างสินค้า B',price:249,stock:999,cat:'ไอเทม',em:'🎁',img:''}];
const ERR=(m,s=400)=>{const e=new Error(m);e.s=s;return e};
const login=async n=>{const t=c.randomBytes(24).toString('hex');await R('SET','s:'+t,n,'EX',2592000);const u=await G('u:'+n);return{t,me:{n,coins:u.coins}}};
module.exports=async(req,res)=>{try{
if(!U)throw ERR('ยังไม่ได้เชื่อมต่อฐานข้อมูล Upstash Redis',500);
const b=req.body||{},a=b.a,out=o=>res.status(200).json(o);
const adm=!!process.env.ADMIN_KEY&&req.headers['x-admin-key']===process.env.ADMIN_KEY;
const st=await G('settings',DS),pr=await G('products',DP);
if(a==='shop')return out({st,pr});
if(a==='register'){const n=String(b.n||'').trim().toLowerCase();
if(!/^[a-z0-9_]{3,20}$/.test(n))throw ERR('ชื่อผู้ใช้ใช้ a-z 0-9 _ ความยาว 3-20 ตัว');
if(String(b.p||'').length<6)throw ERR('รหัสผ่านอย่างน้อย 6 ตัว');
if(await G('u:'+n))throw ERR('ชื่อนี้ถูกใช้แล้ว');
const s=c.randomBytes(8).toString('hex');await S('u:'+n,{n,s,h:H(b.p,s),coins:0});await R('SADD','users',n);return out(await login(n))}
if(a==='login'){const n=String(b.n||'').trim().toLowerCase(),u=await G('u:'+n);
if(!u||H(b.p,u.s)!==u.h)throw ERR('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');return out(await login(n))}
if(a.startsWith('a_')){if(!adm)throw ERR('รหัสแอดมินไม่ถูกต้อง',401);
if(a==='a_all'){const names=await R('SMEMBERS','users')||[];const users=[];for(const n of names){const u=await G('u:'+n);if(u)users.push({n,coins:u.coins})}
return out({st,pr,users,orders:await G('orders',[]),topups:await G('topups',[])})}
if(a==='a_save'){if(b.st)await S('settings',b.st);if(b.pr)await S('products',b.pr);return out({ok:1})}
if(a==='a_slip')return out({img:await R('GET','slip:'+b.id)});
if(a==='a_topup'){const l=await G('topups',[]),t=l.find(x=>x.id===b.id);if(!t||t.s!=='pending')throw ERR('ไม่พบรายการ');
t.s=b.ok?'approved':'rejected';if(b.ok){const u=await G('u:'+t.n);u.coins+=t.amount;await S('u:'+t.n,u)}await S('topups',l);return out({ok:1})}
if(a==='a_deliver'){const l=await G('orders',[]),o=l.find(x=>x.id===b.id);if(!o)throw ERR('ไม่พบออเดอร์');o.s='done';o.d=String(b.text||'');await S('orders',l);return out({ok:1})}
if(a==='a_coins'){const u=await G('u:'+String(b.n).toLowerCase());if(!u)throw ERR('ไม่พบสมาชิก');u.coins+=Number(b.amount)||0;await S('u:'+u.n,u);return out({ok:1})}
throw ERR('unknown')}
const n=b.t&&await R('GET','s:'+b.t);if(!n)throw ERR('กรุณาเข้าสู่ระบบ',401);
const u=await G('u:'+n);
if(a==='me')return out({me:{n,coins:u.coins}});
if(a==='buy'){const p=pr.find(x=>x.id==b.id),q=Math.floor(Number(b.q));if(!p||!(q>=1&&q<=99))throw ERR('ข้อมูลไม่ถูกต้อง');
if(p.stock<q)throw ERR('สินค้าไม่พอ');const tot=p.price*q;if(u.coins<tot)throw ERR('คอยน์ไม่พอ กรุณาเติมคอยน์');
u.coins-=tot;if(p.stock<999)p.stock-=q;await S('u:'+n,u);await S('products',pr);
const l=await G('orders',[]);l.unshift({id:'O'+Date.now(),n,item:p.name,q,total:tot,s:'pending',d:'',ts:Date.now()});await S('orders',l);return out({coins:u.coins})}
if(a==='topup'){const amount=Math.floor(Number(b.amount));if(!(amount>=1)||!String(b.slip).startsWith('data:image/')||b.slip.length>900000)throw ERR('ข้อมูลหรือสลิปไม่ถูกต้อง');
const id='T'+Date.now();await S('slip:'+id,b.slip);const l=await G('topups',[]);l.unshift({id,n,amount,s:'pending',ts:Date.now()});await S('topups',l);return out({ok:1})}
if(a==='mine')return out({orders:(await G('orders',[])).filter(x=>x.n===n),topups:(await G('topups',[])).filter(x=>x.n===n)});
throw ERR('unknown')}catch(e){res.status(e.s||500).json({e:e.message})}};
