/* Client-only portfolio tracker and transparent rule-based rebalance helper. */
(() => {
  const STORE = "haerin.portfolio.v1";
  const $ = id => document.getElementById(id);
  let quoteBySymbol = Object.fromEntries(((window.DASH && Array.isArray(window.DASH.stocks)) ? window.DASH.stocks : []).map(x => [String(x.sym).toUpperCase(), x]));
  let advice = {};
  let adviceUpdated = "";
  let state;
  const PROFILES = {
    conservative: {label:"ต่ำ", reserve:.25, caps:{low:.08,med:.05,high:.02,extreme:.005}},
    balanced: {label:"ปานกลาง", reserve:.12, caps:{low:.12,med:.08,high:.04,extreme:.015}},
    aggressive: {label:"สูง", reserve:.07, caps:{low:.15,med:.10,high:.05,extreme:.025}}
  };
  const RISK_SCORE = {low:1,med:.75,high:.45,extreme:.20};
  const WEIGHT_SCORE = {heavy:3,mid:2,light:1};
  state = loadState();
  const fmt = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(Number.isFinite(n)?n:0);
  const fmtNum = (n,d=3) => Number.isFinite(n) ? n.toLocaleString("en-US",{maximumFractionDigits:d}) : "—";
  const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  function cleanSym(s){return String(s||"").trim().toUpperCase().replace(/[^A-Z0-9.-]/g,"").slice(0,10);}

  function loadState(){
    const base={cash:0,goal:15,profile:"balanced",holdings:[]};
    try{
      const raw=JSON.parse(localStorage.getItem(STORE)||"null");
      if(!raw || typeof raw!=="object") return base;
      const savedGoal=Number(raw.goal);
      return {
        cash:Math.max(0,Number(raw.cash)||0), goal:Number.isFinite(savedGoal)?Math.max(0,Math.min(100,savedGoal)):15,
        profile:PROFILES[raw.profile]?raw.profile:"balanced",
        holdings:Array.isArray(raw.holdings)?raw.holdings.map(h=>({symbol:cleanSym(h.symbol),shares:Math.max(0,Number(h.shares)||0),cost:Math.max(0,Number(h.cost)||0),manualPrice:Math.max(0,Number(h.manualPrice)||0)})):[]
      };
    }catch(_){return base;}
  }
  function saveState(){
    try{localStorage.setItem(STORE,JSON.stringify(state));$("saveStatus").textContent="บันทึกใน browser นี้แล้ว · ไม่ได้อัปโหลดพอร์ต";$("saveStatus").className="status ok";}
    catch(_){$("saveStatus").textContent="บันทึกไม่ได้ — browser อาจปิดการใช้ localStorage";$("saveStatus").className="status warn";}
  }
  function fillControls(){
    $("cash").value=state.cash;
    $("goal").value=state.goal;
    $("profile").value=state.profile;
    const symbols=[...new Set([...Object.keys(quoteBySymbol),...Object.keys(advice)])].sort();
    $("symbols").innerHTML=symbols.map(s=>`<option value="${esc(s)}"></option>`).join("");
  }
  function mergedPositions(){
    const map=new Map();
    for(const h of state.holdings){
      const symbol=cleanSym(h.symbol), shares=Number(h.shares)||0, cost=Number(h.cost)||0;
      if(!symbol || shares<=0) continue;
      const old=map.get(symbol)||{symbol,shares:0,costTotal:0,manualPrice:0};
      old.shares+=shares;old.costTotal+=shares*cost;
      if(Number(h.manualPrice)>0) old.manualPrice=Number(h.manualPrice);
      map.set(symbol,old);
    }
    for(const p of map.values()){
      p.avgCost=p.shares?p.costTotal/p.shares:0;
      const live=Number(quoteBySymbol[p.symbol]?.price)||0;
      p.price=live||p.manualPrice||p.avgCost;
      p.priceSource=live?"live":p.manualPrice?"manual":"cost estimate";
      p.marketValue=p.price*p.shares;p.costValue=p.avgCost*p.shares;p.pnl=p.marketValue-p.costValue;
      p.weight=0;
    }
    return map;
  }
  function currentPortfolio(){
    const positions=mergedPositions();
    const invested=[...positions.values()].reduce((a,p)=>a+p.marketValue,0);
    const cost=[...positions.values()].reduce((a,p)=>a+p.costValue,0);
    const cash=Number(state.cash)||0, nav=cash+invested;
    for(const p of positions.values())p.weight=nav?p.marketValue/nav:0;
    return {positions,cash,invested,cost,nav,pnl:invested-cost};
  }
  function renderHoldings(){
    const body=$("holdingsBody");
    if(!state.holdings.length){body.innerHTML='<tr><td colspan="7" class="muted">ยังไม่มีหุ้นที่บันทึกไว้</td></tr>';return;}
    body.innerHTML=state.holdings.map((h,i)=>{
      const symbol=cleanSym(h.symbol), quote=Number(quoteBySymbol[symbol]?.price)||0;
      const p=mergedPositions().get(symbol);
      const live=quote>0;
      const priceCell=live?`<span class="quote">${fmt(quote)}</span><div class="small">watchlist</div>`:
        `<input data-i="${i}" data-field="manualPrice" type="number" min="0" step="0.01" value="${h.manualPrice||""}" placeholder="ราคาปัจจุบัน">`;
      const mv=p?fmt(p.marketValue):"—", pnl=p?`${p.pnl>=0?"+":""}${fmt(p.pnl)}`:"—";
      const qty=Number(h.shares)||0, cost=Number(h.cost)||0;
      return `<tr>
        <td><input data-i="${i}" data-field="symbol" list="symbols" value="${esc(symbol)}" placeholder="เช่น MSFT" aria-label="ticker"></td>
        <td><input data-i="${i}" data-field="shares" type="number" min="0" step="0.001" value="${qty||""}" placeholder="0" aria-label="จำนวนหุ้น"></td>
        <td><input data-i="${i}" data-field="cost" type="number" min="0" step="0.01" value="${cost||""}" placeholder="USD/หุ้น" aria-label="ต้นทุนเฉลี่ย"></td>
        <td>${priceCell}</td><td class="quote">${mv}</td><td class="quote ${p&&p.pnl>=0?"positive":"negative"}">${pnl}</td>
        <td><button class="btn danger" data-remove="${i}" aria-label="ลบ">ลบ</button></td></tr>`;
    }).join("");
  }
  function renderSummary(){
    const p=currentPortfolio();
    $("navValue").textContent=fmt(p.nav);$("cashValue").textContent=fmt(p.cash);$("investedValue").textContent=fmt(p.invested);
    $("pnlValue").textContent=`${p.pnl>=0?"+":""}${fmt(p.pnl)}`;
    $("pnlValue").className="value "+(p.pnl>=0?"positive":"negative");
    const estimates=[...p.positions.values()].filter(x=>x.priceSource!=="live").map(x=>x.symbol);
    const target=Number(state.goal)||0;
    let note=`เงินสดสำรองตาม profile ${PROFILES[state.profile].label}: ${(PROFILES[state.profile].reserve*100).toFixed(0)}% ของมูลค่าพอร์ต · เป้าหมาย ${target}% ไม่ใช่ผลตอบแทนคาดการณ์`;
    if(estimates.length)note+=` · ราคาประเมินเอง/ต้นทุน: ${estimates.join(", ")}`;
    $("portfolioNote").textContent=note;
  }
  function capFor(risk){return PROFILES[state.profile].caps[risk]??PROFILES[state.profile].caps.med;}
  function scoreFor(a,flag){
    const weight=WEIGHT_SCORE[a.weight]||1,risk=RISK_SCORE[a.risk]||RISK_SCORE.med;
    const zone=flag==="DEEP-BUY"?1.25:1;
    return weight*risk*zone;
  }
  function allocateByScore(candidates,budget){
    const allocated=Object.fromEntries(candidates.map(c=>[c.symbol,0]));
    let active=candidates.filter(c=>c.headroom>0),left=Math.max(0,budget),guard=0;
    while(active.length&&left>.01&&guard++<30){
      const total=active.reduce((s,c)=>s+c.score,0)||active.length;
      let capped=false;
      for(const c of [...active]){
        const proposal=left*c.score/total;
        if(proposal>=c.headroom-.01){
          allocated[c.symbol]+=c.headroom;left-=c.headroom;c.headroom=0;
          active=active.filter(x=>x!==c);capped=true;
        }
      }
      if(!capped){
        for(const c of active){const part=left*c.score/total;allocated[c.symbol]+=part;c.headroom-=part;}
        left=0;
      }
    }
    return allocated;
  }
  function calculatePlan(){
    const port=currentPortfolio(), profile=PROFILES[state.profile], rows=[];
    const reserve=port.nav*profile.reserve, budget=Math.max(0,port.cash-reserve);
    const candidates=[];
    for(const [symbol,s] of Object.entries(quoteBySymbol)){
      const a=advice[symbol]||{}, risk=a.risk||"med", flag=s.flag;
      if(a.verdict!=="buy"||!(flag==="BUY-ZONE"||flag==="DEEP-BUY"))continue;
      const price=Number(s.price)||0;if(price<=0)continue;
      const existing=port.positions.get(symbol)?.marketValue||0;
      const cap=profile.caps[risk]??profile.caps.med;
      candidates.push({symbol,price,flag,a,risk,cap,score:scoreFor(a,flag),headroom:Math.max(0,port.nav*cap-existing)});
    }
    const allocated=allocateByScore(candidates,budget);
    for(const c of candidates){
      const raw=allocated[c.symbol]||0, shares=Math.floor((raw/c.price)*1000)/1000, amount=shares*c.price;
      if(shares>0)rows.push({kind:"buy",symbol:c.symbol,price:c.price,shares,amount,flag:c.flag,
        text:`แนะนำ ${aWord(c.a)} · ${c.flag} · risk ${c.risk}; เพดาน ${(c.cap*100).toFixed(1)}% ของพอร์ต`});
    }
    for(const [symbol,p] of port.positions){
      const a=advice[symbol]||{}, risk=a.risk||"med", cap=capFor(risk), maxValue=port.nav*cap;
      const s=quoteBySymbol[symbol]||{}, flag=s.flag||"HOLD";
      let shares=0, reason="";
      if(a.verdict==="avoid"){
        const ratio=(flag==="TARGET"||flag==="NEAR-TARGET")?.25:(risk==="extreme"?.75:.50);
        shares=Math.min(p.shares,Math.floor(p.shares*ratio*1000)/1000);
        reason=`ทบทวน/ลด ${(ratio*100).toFixed(0)}% ตาม verdict เลี่ยง; ไม่ใช่คำสั่งขาย`;
      }else if(p.marketValue>maxValue*1.10){
        shares=Math.min(p.shares,Math.floor(((p.marketValue-maxValue)/Math.max(p.price,.01))*1000)/1000);
        reason=`น้ำหนัก ${(p.weight*100).toFixed(1)}% เกินเพดาน ${(cap*100).toFixed(1)}% ของ profile`;
      }
      if(shares>0)rows.push({kind:"sell",symbol,price:p.price,shares,amount:shares*p.price,flag,
        text:reason+(a.why?` · ${a.why}`:"")});
    }
    rows.sort((a,b)=>a.kind===b.kind?(a.kind==="buy"?b.amount-a.amount:a.amount-b.amount):(a.kind==="sell"?-1:1));
    return {port,profile,reserve,budget,rows,candidates};
  }
  function aWord(a){return a.weight==="heavy"?"น้ำหนักสูง":a.weight==="mid"?"น้ำหนักกลาง":"น้ำหนักเบา";}
  function renderPlan(){
    const plan=calculatePlan();
    const updated=adviceUpdated?new Date(adviceUpdated):null;
    const stale=updated && (Date.now()-updated.getTime()>14*86400000);
    const status=$("adviceStatus");
    if(!Object.keys(advice).length){status.textContent="ยังอ่าน advice.json ไม่ได้ — โหลดข้อมูลใหม่ก่อนวิเคราะห์";status.className="status warn";}
    else{
      const candidates=plan.candidates.length;
      status.textContent=`คำแนะนำ ${Object.keys(advice).length} หุ้น · อัปเดต ${adviceUpdated||"ไม่ทราบเวลา"} · เข้าเงื่อนไขซื้อ ${candidates} หุ้น · กันเงินสด ${fmt(plan.reserve)} · ลงทุนเพิ่มได้สูงสุด ${fmt(plan.budget)}${stale?" · ⚠ ข้อมูลคำแนะนำเกิน 14 วัน":""}`;
      status.className="status "+(stale?"warn":"");
    }
    const body=$("recommendations");
    if(!plan.rows.length){body.innerHTML='<tr><td colspan="6" class="muted">ยังไม่มีรายการปรับพอร์ต — อาจไม่มี buy-zone ที่แนะนำ, เงินสดไม่พอหลังกันสำรอง, หรือไม่มีหุ้นที่ถือ</td></tr>';return;}
    body.innerHTML=plan.rows.map(r=>`<tr>
      <td><span class="signal ${r.kind}">${r.kind==="buy"?"ซื้อเพิ่ม":"ทบทวนขาย"}</span></td>
      <td><b>${esc(r.symbol)}</b><div class="small">${esc(r.flag)}</div></td>
      <td class="nowrap">${fmt(r.price)}</td><td>${fmtNum(r.shares,3)}</td><td>${fmt(r.amount)}</td>
      <td class="recommend">${esc(r.text)}</td></tr>`).join("");
  }
  function renderAll(){renderHoldings();renderSummary();renderPlan();}
  function readControls(){
    state.cash=Math.max(0,Number($("cash").value)||0);
    state.goal=Math.max(0,Math.min(100,Number($("goal").value)||0));
    state.profile=PROFILES[$("profile").value]?$("profile").value:"balanced";
    saveState();renderSummary();renderPlan();
  }
  $("cash").addEventListener("input",readControls);$("goal").addEventListener("input",readControls);$("profile").addEventListener("change",readControls);
  $("holdingsBody").addEventListener("input",e=>{
    const field=e.target.dataset.field, i=Number(e.target.dataset.i);if(!field||!Number.isInteger(i)||!state.holdings[i])return;
    if(field==="symbol")state.holdings[i][field]=cleanSym(e.target.value);
    else state.holdings[i][field]=Math.max(0,Number(e.target.value)||0);
    saveState();renderSummary();renderPlan();
  });
  $("holdingsBody").addEventListener("change",e=>{if(e.target.dataset.field){renderHoldings();renderSummary();renderPlan();}});
  $("holdingsBody").addEventListener("click",e=>{
    const i=Number(e.target.dataset.remove);if(!Number.isInteger(i))return;
    state.holdings.splice(i,1);saveState();renderAll();
  });
  $("addBtn").addEventListener("click",()=>{state.holdings.push({symbol:"",shares:0,cost:0,manualPrice:0});saveState();renderHoldings();$("holdingsBody").lastElementChild?.querySelector('[data-field="symbol"]')?.focus();});
  $("clearBtn").addEventListener("click",()=>{
    if(!confirm("ล้างเงินสดและข้อมูลหุ้นที่บันทึกไว้ใน browser นี้?"))return;
    state={cash:0,goal:15,profile:"balanced",holdings:[]};saveState();fillControls();renderAll();
  });
  $("exportBtn").addEventListener("click",()=>{
    const blob=new Blob([JSON.stringify({version:1,...state},null,2)],{type:"application/json"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="haerin-portfolio-backup.json";a.click();URL.revokeObjectURL(a.href);
  });
  $("importBtn").addEventListener("click",()=>$("importFile").click());
  $("importFile").addEventListener("change",async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const x=JSON.parse(await file.text());if(!Array.isArray(x.holdings))throw new Error("missing holdings");
      const importedGoal=Number(x.goal);
      state={cash:Math.max(0,Number(x.cash)||0),goal:Number.isFinite(importedGoal)?Math.max(0,Math.min(100,importedGoal)):15,profile:PROFILES[x.profile]?x.profile:"balanced",
        holdings:x.holdings.map(h=>({symbol:cleanSym(h.symbol),shares:Math.max(0,Number(h.shares)||0),cost:Math.max(0,Number(h.cost)||0),manualPrice:Math.max(0,Number(h.manualPrice)||0)}))};
      saveState();fillControls();renderAll();
    }catch(_){alert("ไฟล์สำรองไม่ถูกต้อง");}finally{e.target.value="";}
  });
  function makeBrief(){
    const plan=calculatePlan(), p=plan.port;
    const holdings=[...p.positions.values()].map(x=>({ticker:x.symbol,shares:Number(x.shares.toFixed(4)),avg_cost:Number(x.avgCost.toFixed(2)),current_price:Number(x.price.toFixed(2)),price_source:x.priceSource,market_value:Number(x.marketValue.toFixed(2)),unrealized_pnl:Number(x.pnl.toFixed(2)),portfolio_weight_pct:Number((x.weight*100).toFixed(2)),advice:advice[x.symbol]||null,zone:quoteBySymbol[x.symbol]?.flag||"untracked"}));
    const actions=plan.rows.map(x=>({action:x.kind,ticker:x.symbol,shares:x.shares,price:x.price,amount:Number(x.amount.toFixed(2)),reason:x.text}));
    return `ช่วยวิเคราะห์พอร์ตอย่างระมัดระวังจากข้อมูลต่อไปนี้ ห้ามรับประกันผลตอบแทนหรือสร้าง expected return เอง; เป้าหมายเป็นเพียงความต้องการผู้ใช้. ระบุความเสี่ยง, concentration, ข้อจำกัดของข้อมูล, และข้อเสนอซื้อ/ลดที่ต้องให้ผู้ใช้ตัดสินใจเอง. ไม่มีการส่งคำสั่งซื้อขาย.\n\n${JSON.stringify({asof:new Date().toISOString(),annual_return_goal_pct:state.goal,risk_profile:state.profile,cash_usd:Number(p.cash.toFixed(2)),portfolio_value_usd:Number(p.nav.toFixed(2)),unrealized_pnl_usd:Number(p.pnl.toFixed(2)),advice_updated:adviceUpdated,holdings,local_rule_based_actions:actions},null,2)}`;
  }
  $("copyBtn").addEventListener("click",async()=>{
    const text=makeBrief();$("aiBrief").value=text;
    try{await navigator.clipboard.writeText(text);$("copyStatus").textContent="คัดลอกแล้วค่ะ — ยังไม่มีข้อมูลส่งออกจนกว่าคุณจะวาง brief ในแชตเอง";$("copyStatus").className="status ok";}
    catch(_){$("aiBrief").focus();$("aiBrief").select();document.execCommand("copy");$("copyStatus").textContent="เลือกและคัดลอก brief แล้ว; วางในแชตได้เมื่อพร้อมค่ะ";$("copyStatus").className="status ok";}
  });

  async function loadAdvice(){
    try{const r=await fetch("data/advice.json?_="+Date.now(),{cache:"no-store"});if(!r.ok)throw Error(r.status);const j=await r.json();advice=j.advice||{};adviceUpdated=j.updated||"";renderPlan();}
    catch(_){$("adviceStatus").textContent="โหลด advice.json ไม่สำเร็จ; คำนวณมูลค่าพอร์ตยังใช้ได้ แต่ข้อเสนอซื้อ/ลดไม่พร้อม";$("adviceStatus").className="status warn";}
  }
  async function refreshPublicData(){
    const btn=$("refreshDataBtn");if(btn)btn.disabled=true;
    try{
      const r=await fetch("data/stocks.js?_="+Date.now(),{cache:"no-store"});if(!r.ok)throw Error(r.status);
      const text=await r.text(), next=JSON.parse(text.slice(text.indexOf("{")).trim().replace(/;+$/, ""));
      if(!Array.isArray(next.stocks))throw Error("invalid stocks payload");
      window.DASH=next;quoteBySymbol=Object.fromEntries(next.stocks.map(x=>[String(x.sym).toUpperCase(),x]));
      fillControls();renderAll();await loadAdvice();
      $("marketStatus").textContent=`ราคา/zone อัปเดต ${next.updated||"—"} · advice ${adviceUpdated||"—"} · ข้อมูลพอร์ตยังอยู่ใน browser`;
      $("marketStatus").className="status ok";
    }catch(_){$("marketStatus").textContent="อัปเดตราคา/คำแนะนำไม่สำเร็จ; ใช้ snapshot ล่าสุด";$("marketStatus").className="status warn";}
    finally{if(btn)btn.disabled=false;}
  }
  $("refreshDataBtn").addEventListener("click",refreshPublicData);
  fillControls();renderAll();loadAdvice();
  setInterval(refreshPublicData,60000);
})();
