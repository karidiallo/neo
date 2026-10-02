import { categories, loadLocal, persistLocal, dateKey, isoAt, localParts, newDay } from "./state.js";
import { getLevelInfo, xpForTask } from "./levels.js";
import { sendMagicLink, signInPassword, setPassword, signOut, sendPasswordReset, onAuth, cloudHasData, hydrateCloud, syncCloud, seedSyncFingerprints, deleteTaskRow, deleteDailyLogRow } from "./supabase.js";

let state=loadLocal();
let user=null, cloudReady=false, syncTimer=null;
const todayKey=dateKey();
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const uuid=()=>crypto.randomUUID();

function ensureDay(){ if(!state.days[todayKey]) state.days[todayKey]=newDay(); return state.days[todayKey]; }
function finance(){ if(!state.financeSnapshots[todayKey]) state.financeSnapshots[todayKey]={cash:"0 zł",protected:"0 zł",incoming:"0 zł",bills:"0 zł",revenueToday:"0 zł",revenueMonth:"0 zł"}; return state.financeSnapshots[todayKey]; }
function body(){ if(!state.bodyLogs[todayKey]) state.bodyLogs[todayKey]={steps:"",weight:"",water:"",sleep:"",workout:false}; return state.bodyLogs[todayKey]; }
function done(t){return t.status==="done"||!!t.completedAt}
function scheduled(t){return !!t.scheduledAt&&!done(t)}
function catLabel(id){return categories.find(c=>c.id===id)?.label||id}
function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),1500)}
function syncStatus(msg){$("#syncStatus").textContent="Chmura: "+msg}

function addDailyLog(section,title,note="",payload={}){
  state.dailyLogs = state.dailyLogs || [];
  state.dailyLogs.unshift({
    id:uuid(),date:todayKey,section,title,note,payload,createdAt:new Date().toISOString()
  });
}
function logsFor(section){
  return (state.dailyLogs||[]).filter(x=>x.date===todayKey && (!section || x.section===section));
}
function formatLogTime(iso){
  return new Date(iso).toLocaleTimeString("pl-PL",{hour:"2-digit",minute:"2-digit"});
}
function renderLogList(selector,sections=null){
  const root=$(selector); if(!root)return;
  let logs=(state.dailyLogs||[]).filter(x=>x.date===todayKey);
  if(Array.isArray(sections)) logs=logs.filter(x=>sections.includes(x.section));
  else if(typeof sections==="string") logs=logs.filter(x=>x.section===sections);
  if(!logs.length){root.innerHTML='<div class="helper" style="padding:14px">Jeszcze nic dziś nie zapisano w tej sekcji.</div>';return}
  root.innerHTML=logs.map(x=>`<div class="log-entry">
    <div class="log-time">${formatLogTime(x.createdAt)}</div>
    <div class="log-section">${esc(sectionLabel(x.section))}</div>
    <div class="log-copy"><strong>${esc(x.title)}</strong>${x.note?`<span>${esc(x.note)}</span>`:""}</div>
    <div class="log-actions">
      <button class="log-action" data-log-edit="${x.id}" title="Edytuj">✎</button>
      <button class="log-action delete" data-log-delete="${x.id}" title="Usuń">×</button>
    </div>
  </div>`).join("");

  root.querySelectorAll("[data-log-edit]").forEach(btn=>btn.onclick=()=>{
    const log=(state.dailyLogs||[]).find(x=>x.id===btn.dataset.logEdit); if(!log)return;
    const title=prompt("Tytuł logu",log.title); if(title===null)return;
    const note=prompt("Treść / notatka",log.note||""); if(note===null)return;
    log.title=title.trim()||log.title;
    log.note=note.trim();
    save();renderAll();toast("Log zaktualizowany.");
  });

  root.querySelectorAll("[data-log-delete]").forEach(btn=>btn.onclick=async()=>{
    const id=btn.dataset.logDelete;
    const log=(state.dailyLogs||[]).find(x=>x.id===id); if(!log)return;
    if(!confirm(`Usunąć log „${log.title}”?`))return;
    state.dailyLogs=(state.dailyLogs||[]).filter(x=>x.id!==id);
    persistLocal(state);renderAll();
    try{
      if(cloudReady&&user) await deleteDailyLogRow(id);
      seedSyncFingerprints(state);
      toast("Log usunięty.");
    }catch(e){
      console.error(e);
      toast("Usunięto lokalnie, ale chmura zwróciła błąd.");
    }
  });
}

function sectionLabel(s){
  return ({capacity:"Tempo dnia",top3:"Wyniki dnia",money:"Ruch finansowy",minimums:"Podstawy",finance:"Finanse",body:"Ciało",projects:"Projekty"})[s]||s;
}

function save(){
  persistLocal(state);
  if(cloudReady&&user){
    clearTimeout(syncTimer);
    syncTimer=setTimeout(async()=>{
      try{
        syncStatus("zapisywanie…");
        await syncCloud(user.id,state);
        syncStatus("zsynchronizowano");
      }catch(e){
        console.error(e);
        syncStatus("offline / błąd");
      }
    },1400);
  }
}

function calculateCapacity(){
  const i=ensureDay().interview;
  const sleepHoursScore=Math.max(0,10-Math.abs((i.sleepHours||0)-7.5)*2);
  const timeScore=Math.min(10,(i.availableHours||0)/6*10);
  let score=i.energy*.34+i.sleepQuality*.18+sleepHoursScore*.12+(11-i.overload)*.22+timeScore*.14;
  score=Math.max(1,Math.min(10,score));
  let mode,label,copy;
  if(score>=7&&i.availableHours>=4){mode="full";label="Dzisiaj robimy pełny dzień.";copy="Masz zasoby na trzy ważne wyniki i kilka godzin realnego outputu. Nadal pilnujemy priorytetów."}
  else if(score>=4){mode="standard";label="Dzisiaj robimy dzień standardowy.";copy="Najważniejsze są 2–3 sensowne wyniki, jeden ruch finansowy i podstawy życia."}
  else{mode="survival";label="Dzisiaj robimy dzień minimalny.";copy="Jedno najważniejsze zadanie, jeden mały ruch finansowy i podstawy. Nie dokładamy sztucznego obciążenia."}
  ensureDay().capacity={score,percent:Math.round(score*10),mode,label,copy};
}

/* auth */
const AUTH_PROFILE_KEY="personalOS_auth_profile_v1";
const AUTH_PENDING_KEY="personalOS_auth_pending_setup";
const AUTH_RESET_KEY="personalOS_auth_password_reset";
let hydratedUserId=null;
let authHandledInitial=false;

function getAuthProfile(){
  try{return JSON.parse(localStorage.getItem(AUTH_PROFILE_KEY)||"null")}catch{return null}
}
function setAuthProfile(email){
  localStorage.setItem(AUTH_PROFILE_KEY,JSON.stringify({email,passwordReady:true}));
}
function clearPendingSetup(){localStorage.removeItem(AUTH_PENDING_KEY)}
function pendingSetup(){return localStorage.getItem(AUTH_PENDING_KEY)==="1"}
function setPendingSetup(value){value?localStorage.setItem(AUTH_PENDING_KEY,"1"):clearPendingSetup()}
function pendingReset(){return localStorage.getItem(AUTH_RESET_KEY)==="1"}
function setPendingReset(value){value?localStorage.setItem(AUTH_RESET_KEY,"1"):localStorage.removeItem(AUTH_RESET_KEY)}

function showAuthState(name){
  $("#bootGate").classList.add("hidden");
  $("#authGate").classList.remove("hidden");
  $$(".auth-state").forEach(x=>x.classList.add("hidden"));
  $("#"+name).classList.remove("hidden");

  const profile=getAuthProfile();
  if(name==="authPasswordStep" && profile?.email){
    $("#loginEmail").value=profile.email;
    setTimeout(()=>$("#loginPassword").focus(),0);
  }
}

function showLoggedInApp(){
  $("#bootGate").classList.add("hidden");
  $("#authGate").classList.add("hidden");
}

function showLoggedOutEntry(){
  const profile=getAuthProfile();
  showAuthState(profile?.passwordReady ? "authPasswordStep" : "authFirstStep");
}

async function initAuth(){
  $("#firstEmailButton").onclick=async()=>{
    const email=$("#firstEmail").value.trim();
    if(!email){$("#firstEmailMessage").textContent="Wpisz email.";return}
    $("#firstEmailButton").disabled=true;
    $("#firstEmailMessage").textContent="Wysyłam link…";
    setPendingSetup(true);
    localStorage.setItem("personalOS_pending_email",email);
    const {error}=await sendMagicLink(email);
    if(error){
      setPendingSetup(false);
      $("#firstEmailButton").disabled=false;
      $("#firstEmailMessage").textContent=error.message;
      return;
    }
    $("#sentEmailLabel").textContent=email;
    $("#firstEmailMessage").textContent="";
    showAuthState("authCheckEmail");
  };

  $("#alreadyPasswordButton").onclick=()=>{
    const email=$("#firstEmail").value.trim();
    if(email) $("#loginEmail").value=email;
    showAuthState("authPasswordStep");
  };

  $("#changeEmailButton").onclick=()=>{
    setPendingSetup(false);
    showAuthState("authFirstStep");
  };

  $("#loginPasswordButton").onclick=async()=>{
    const email=$("#loginEmail").value.trim(),password=$("#loginPassword").value;
    if(!email||!password){$("#loginMessage").textContent="Wpisz email i hasło.";return}
    $("#loginPasswordButton").disabled=true;
    $("#loginMessage").textContent="Loguję…";
    const {error}=await signInPassword(email,password);
    $("#loginPasswordButton").disabled=false;
    if(error){
      $("#loginMessage").textContent="Nieprawidłowy email lub hasło.";
      return;
    }
    setAuthProfile(email);
    $("#loginMessage").textContent="";
  };

  $("#forgotPasswordButton").onclick=async()=>{
    const email=$("#loginEmail").value.trim();
    if(!email){$("#loginMessage").textContent="Najpierw wpisz email.";return}
    $("#loginMessage").textContent="Wysyłam link…";
    setPendingReset(true);
    const {error}=await sendPasswordReset(email);
    if(error){
      setPendingReset(false);
      $("#loginMessage").textContent=error.message;
      return;
    }
    showAuthState("authResetSent");
  };

  $("#useMagicInsteadButton").onclick=()=>{
    $("#firstEmail").value=$("#loginEmail").value.trim();
    showAuthState("authFirstStep");
  };

  $("#backToPasswordLogin").onclick=()=>{
    setPendingReset(false);
    showAuthState("authPasswordStep");
  };

  $("#setupPasswordButton").onclick=async()=>{
    const p1=$("#setupPassword").value,p2=$("#setupPassword2").value;
    if(p1.length<8){$("#setupPasswordMessage").textContent="Hasło powinno mieć co najmniej 8 znaków.";return}
    if(p1!==p2){$("#setupPasswordMessage").textContent="Hasła nie są identyczne.";return}
    $("#setupPasswordButton").disabled=true;
    $("#setupPasswordMessage").textContent="Zapisuję hasło…";
    const {data,error}=await setPassword(p1);
    $("#setupPasswordButton").disabled=false;
    if(error){
      $("#setupPasswordMessage").textContent="Nie udało się zapisać hasła: "+error.message;
      return;
    }

    const email=data?.user?.email || localStorage.getItem("personalOS_pending_email") || "";
    if(email) setAuthProfile(email);
    clearPendingSetup();
    setPendingReset(false);
    localStorage.removeItem("personalOS_pending_email");
    $("#setupPasswordMessage").textContent="Hasło zapisane.";

    // Session already exists after Magic Link / reset link. Now load the app.
    if(data?.user){
      const sessionLike={user:data.user};
      await hydrateAuthenticatedUser(sessionLike);
    }
  };

  // Single source of truth: auth events. No separate getSession() call,
  // so INITIAL_SESSION is handled only once and the login UI does not flash.
  onAuth((event,session)=>{
    setTimeout(()=>handleAuthEvent(event,session),0);
  });
}

async function hydrateAuthenticatedUser(session){
  user=session.user;
  showLoggedInApp();

  if(cloudReady && hydratedUserId===user.id) return;

  syncStatus("pobieranie…");
  try{
    if(await cloudHasData(user.id)){
      state=await hydrateCloud(user.id);
      persistLocal(state);
      seedSyncFingerprints(state);
    } else {
      await syncCloud(user.id,state,{force:true});
      seedSyncFingerprints(state);
    }
    hydratedUserId=user.id;
    cloudReady=true;
    syncStatus("zsynchronizowano");
    renderAll();
    openBriefingIfNeeded();
  }catch(e){
    console.error(e);
    cloudReady=false;
    syncStatus("błąd synchronizacji");
  }
}

async function handleAuthEvent(event,session){
  if(event==="TOKEN_REFRESHED"){
    if(session?.user) user=session.user;
    return;
  }

  if(event==="USER_UPDATED"){
    if(session?.user) user=session.user;
    return;
  }

  if(event==="SIGNED_OUT"){
    user=null;cloudReady=false;hydratedUserId=null;
    showLoggedOutEntry();
    syncStatus("wylogowano");
    return;
  }

  if(event==="PASSWORD_RECOVERY" && session?.user){
    user=session.user;
    $("#bootGate").classList.add("hidden");
    $("#authGate").classList.remove("hidden");
    showAuthState("authSetPassword");
    $("#setupPasswordMessage").textContent="Ustaw nowe hasło.";
    return;
  }

  if((event==="INITIAL_SESSION" || event==="SIGNED_IN") && session?.user){
    user=session.user;

    // The first Magic Link is an onboarding hand-off.
    // Do NOT open the dashboard before a password is created.
    if(pendingSetup()){
      if(session.user.user_metadata?.password_set===true){
        // This can happen on a new device where the account already has a password.
        setAuthProfile(session.user.email||"");
        clearPendingSetup();
        await hydrateAuthenticatedUser(session);
      }else{
        $("#bootGate").classList.add("hidden");
        $("#authGate").classList.remove("hidden");
        showAuthState("authSetPassword");
      }
      return;
    }

    if(pendingReset()){
      showAuthState("authSetPassword");
      $("#setupPasswordMessage").textContent="Ustaw nowe hasło.";
      return;
    }

    if(session.user.user_metadata?.password_set===true && session.user.email){
      setAuthProfile(session.user.email);
    }

    await hydrateAuthenticatedUser(session);
    return;
  }

  if(event==="INITIAL_SESSION" && !session?.user){
    authHandledInitial=true;
    showLoggedOutEntry();
    syncStatus("wylogowano");
    return;
  }

  if(!session?.user){
    showLoggedOutEntry();
  }
}

$("#accountButton").onclick=()=>{$("#accountModal").classList.remove("hidden");$("#accountMessage").textContent=""};
$("#accountCancel").onclick=()=>$("#accountModal").classList.add("hidden");
$("#accountLogout").onclick=async()=>{await signOut();$("#accountModal").classList.add("hidden");$("#authGate").classList.remove("hidden");};
$("#accountSave").onclick=async()=>{
  const a=$("#newPassword").value,b=$("#newPassword2").value;
  if(a.length<8){$("#accountMessage").textContent="Hasło powinno mieć co najmniej 8 znaków.";return}
  if(a!==b){$("#accountMessage").textContent="Hasła nie są identyczne.";return}
  $("#accountMessage").textContent="Zapisuję…";
  const {data,error}=await setPassword(a);
  if(error){$("#accountMessage").textContent="Nie udało się ustawić hasła: "+error.message;return}
  if(data?.user?.email) setAuthProfile(data.user.email);
  $("#accountMessage").textContent="Hasło zapisane.";
  $("#newPassword").value="";$("#newPassword2").value="";
};

function formatEstimate(minutes){
  if(minutes===null || minutes===undefined || minutes==="") return "czas nieokreślony";
  const n=Number(minutes);
  if(!Number.isFinite(n)) return "czas nieokreślony";
  if(n<60) return `${n} min`;
  const h=n/60;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1).replace(".",",")} h`;
}
function customCategoryLabel(category){
  if(category?.startsWith("custom:")) return category.slice(7);
  return catLabel(category);
}

/* briefing */
let briefStep=0;
const steps=[
  {render:()=>`<h2>Jak się dziś czujesz?</h2><p class="helper">Napisz własnymi słowami, co dzieje się w głowie i ciele.</p><textarea id="qFeeling">${esc(ensureDay().interview.feeling||"")}</textarea>`,save:()=>ensureDay().interview.feeling=$("#qFeeling").value.trim()},
  {render:()=>`<h2>Ile masz energii?</h2><div class="big-num" id="energyNum">${ensureDay().interview.energy}</div><input id="qEnergy" type="range" min="1" max="10" value="${ensureDay().interview.energy}">`,bind:()=>$("#qEnergy").oninput=e=>$("#energyNum").textContent=e.target.value,save:()=>ensureDay().interview.energy=Number($("#qEnergy").value)},
  {render:()=>`<h2>Jak wyglądał sen?</h2><label>Godziny<input id="qSleepHours" type="number" step=".5" value="${ensureDay().interview.sleepHours}"></label><label>Jakość 1–10<input id="qSleepQuality" type="number" min="1" max="10" value="${ensureDay().interview.sleepQuality}"></label>`,save:()=>{ensureDay().interview.sleepHours=Number($("#qSleepHours").value)||0;ensureDay().interview.sleepQuality=Number($("#qSleepQuality").value)||1}},
  {render:()=>`<h2>Jak przeciążona jest głowa?</h2><div class="big-num" id="overNum">${ensureDay().interview.overload}</div><input id="qOver" type="range" min="1" max="10" value="${ensureDay().interview.overload}">`,bind:()=>$("#qOver").oninput=e=>$("#overNum").textContent=e.target.value,save:()=>ensureDay().interview.overload=Number($("#qOver").value)},
  {render:()=>`<h2>Ile realnego czasu masz dziś na pracę?</h2><select id="qHours"><option value="1">około 1 godziny</option><option value="2">około 2 godzin</option><option value="3">około 3 godzin</option><option value="4">około 4 godzin</option><option value="5">około 5 godzin</option><option value="6">6 godzin lub więcej</option></select>`,bind:()=>$("#qHours").value=String(ensureDay().interview.availableHours||4),save:()=>ensureDay().interview.availableHours=Number($("#qHours").value)},
  {render:()=>{calculateCapacity();const c=ensureDay().capacity;return `<h2>${esc(c.label)}</h2><p class="helper">${esc(c.copy)}</p><div class="chips"><span>Pojemność ${c.percent}%</span><span>Energia ${ensureDay().interview.energy}/10</span><span>${ensureDay().interview.availableHours} h pracy</span></div>`},save:()=>{}}
];
function renderBrief(){
  const s=steps[briefStep];$("#briefingQuestion").innerHTML=s.render();s.bind?.();
  $("#briefingProgress").innerHTML=steps.map((_,i)=>`<i class="${i<=briefStep?"on":""}"></i>`).join("");
  $("#briefingBack").style.visibility=briefStep===0?"hidden":"visible";
  $("#briefingNext").textContent=briefStep===steps.length-1?"Otwórz dzień":"Dalej";
}
function openBriefingIfNeeded(){if(!ensureDay().interviewCompleted){$("#morningGate").classList.remove("hidden");renderBrief()}}
$("#briefingBack").onclick=()=>{if(briefStep){briefStep--;renderBrief()}};
$("#briefingNext").onclick=()=>{steps[briefStep].save();if(briefStep<steps.length-1){if(briefStep===4)calculateCapacity();briefStep++;save();renderBrief();return}calculateCapacity();ensureDay().interviewCompleted=true;
  addDailyLog("capacity","Poranny briefing",ensureDay().capacity.label,{mode:ensureDay().capacity.mode,energy:ensureDay().interview.energy});
  save();$("#morningGate").classList.add("hidden");renderAll()};


let selectedCapacityMode=null;
$("#changeCapacity").onclick=()=>{
  selectedCapacityMode=ensureDay().capacity.mode||"standard";
  $$("[data-capacity-mode]").forEach(b=>b.classList.toggle("selected",b.dataset.capacityMode===selectedCapacityMode));
  $("#capacityEnergyNow").value=ensureDay().currentEnergy??"";
  $("#capacityNote").value="";
  $("#capacityModal").classList.remove("hidden");
};
$$("[data-capacity-mode]").forEach(b=>b.onclick=()=>{
  selectedCapacityMode=b.dataset.capacityMode;
  $$("[data-capacity-mode]").forEach(x=>x.classList.toggle("selected",x===b));
});
$("#capacityCancel").onclick=()=>$("#capacityModal").classList.add("hidden");
$("#capacitySave").onclick=()=>{
  const d=ensureDay();
  const mode=selectedCapacityMode||d.capacity.mode||"standard";
  const map={
    full:{label:"Od teraz działasz w trybie pełnym.",copy:"Masz więcej zasobów na dalszą część dnia. Nadal pilnujemy priorytetów."},
    standard:{label:"Od teraz działasz w trybie standardowym.",copy:"Wracasz do normalnego tempa: 2–3 ważne wyniki i bez dokładania chaosu."},
    survival:{label:"Od teraz zwalniasz do trybu minimalnego.",copy:"Dalsza część dnia ma chronić zasoby: jedna ważna rzecz, podstawy i zero nadrabiania na siłę."}
  };
  const energyRaw=$("#capacityEnergyNow").value;
  const energy=energyRaw===""?null:Math.max(1,Math.min(10,Number(energyRaw)));
  const note=$("#capacityNote").value.trim();
  d.capacity.mode=mode;
  d.capacity.label=map[mode].label;
  d.capacity.copy=map[mode].copy;
  d.capacity.updatedAt=new Date().toISOString();
  d.currentEnergy=energy;
  addDailyLog("capacity",`Zmiana trybu na ${mode==="full"?"Pełny":mode==="standard"?"Standardowy":"Minimalny"}`,note,{
    mode,energy,previousMorningEnergy:d.interview.energy
  });
  save();
  $("#capacityModal").classList.add("hidden");
  renderAll();
  toast("Tempo dnia zapisane.");
};

/* nav */
$$(".nav").forEach(b=>b.onclick=()=>{const name=b.dataset.view;$$(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));$$(".nav").forEach(n=>n.classList.toggle("active",n===b));window.scrollTo({top:0,behavior:"smooth"});renderAll()});

/* tasks modal */
let taskStep=0,draft={title:"",category:"personal",priority:"P2",estimateMinutes:30,customCategory:"",customDuration:false};
function openTask(){taskStep=0;draft={title:"",category:"personal",priority:"P2",estimateMinutes:30,customCategory:"",customDuration:false};$("#taskModal").classList.remove("hidden");renderTaskStep()}
["addTaskHero","addTaskSide","addTaskTasks"].forEach(id=>$("#"+id).onclick=openTask);
$("#taskCancel").onclick=()=>$("#taskModal").classList.add("hidden");
$("#taskBack").onclick=()=>{if(taskStep){taskStep--;renderTaskStep()}};
$("#taskNext").onclick=()=>{
  if(taskStep===0){draft.title=$("#newTaskTitle").value.trim();if(!draft.title){toast("Wpisz nazwę zadania.");return}}
  if(taskStep===1 && draft.category==="other"){
    draft.customCategory=$("#customCategory")?.value.trim()||draft.customCategory||"";
    if(!draft.customCategory){toast("Wpisz własną kategorię.");return}
  }
  if(taskStep===3 && draft.customDuration){
    const value=Number($("#customDurationValue")?.value||0);
    if(!value){toast("Wpisz własny czas albo wybierz „Nie wiem”.");return}
    draft.estimateMinutes=$("#customDurationUnit").value==="hours" ? Math.round(value*60) : Math.round(value);
  }
  if(taskStep<4){taskStep++;renderTaskStep();return}
  const finalCategory=draft.category==="other" ? `custom:${(draft.customCategory||"Inne").trim()}` : draft.category;
  state.tasks.unshift({id:uuid(),title:draft.title,category:finalCategory,priority:draft.priority,estimateMinutes:draft.estimateMinutes,actualMinutes:null,scheduledAt:null,scheduledMinutes:null,completedAt:null,status:"unscheduled",notes:"",dueDate:null,linkUrl:"",checklist:[],createdAt:new Date().toISOString()});
  save();$("#taskModal").classList.add("hidden");renderAll();toast("Zapisane jako niezaplanowane.");
};
function renderTaskStep(){
  const root=$("#taskStep");
  if(taskStep===0){
    root.innerHTML=`<label>Co chcesz zrobić?<input id="newTaskTitle" placeholder="np. poprawić dashboard Personal OS"></label>`;
  }

  if(taskStep===1){
    root.innerHTML=`<p class="helper">Czego głównie dotyczy to zadanie?</p>
      <div class="choices">
        ${categories.map(c=>`<button type="button" class="choice ${draft.category===c.id?"selected":""}" data-cat="${c.id}">
          <strong>${c.label}</strong><small>${c.desc}</small>
        </button>`).join("")}
      </div>
      ${draft.category==="other" ? `<input id="customCategory" placeholder="Wpisz własną kategorię…" value="${esc(draft.customCategory||"")}">` : ""}`;
  }

  if(taskStep===2){
    root.innerHTML=`<p class="helper">Jak ważne jest to zadanie?</p><div class="choices">
      ${["P1","P2","P3"].map(p=>`<button type="button" class="choice ${draft.priority===p?"selected":""}" data-pr="${p}">
        <strong>${p}</strong><small>${p==="P1"?"Krytyczne":p==="P2"?"Ważne":"Dodatkowe"}</small>
      </button>`).join("")}
    </div>`;
  }

  if(taskStep===3){
    const options=[
      {label:"Nie wiem",value:"unknown"},
      {label:"15 min",value:"15"},{label:"30 min",value:"30"},{label:"45 min",value:"45"},
      {label:"1 h",value:"60"},{label:"1,5 h",value:"90"},{label:"2 h",value:"120"},
      {label:"3 h",value:"180"},{label:"Własny czas",value:"custom"}
    ];
    root.innerHTML=`<p class="helper">Ile realnie to zajmie? Jeśli nie wiesz — nie zgaduj.</p>
      <div class="choices">
        ${options.map(o=>{
          const selected = o.value==="unknown" ? draft.estimateMinutes===null :
            o.value==="custom" ? draft.customDuration :
            (!draft.customDuration && draft.estimateMinutes===Number(o.value));
          return `<button type="button" class="choice ${selected?"selected":""}" data-duration="${o.value}"><strong>${o.label}</strong></button>`;
        }).join("")}
      </div>
      ${draft.customDuration ? `<div class="duration-custom">
        <input id="customDurationValue" type="number" min="0.25" step="0.25" placeholder="np. 4">
        <select id="customDurationUnit"><option value="hours">godziny</option><option value="minutes">minuty</option></select>
      </div>` : ""}`;
  }

  if(taskStep===4){
    root.innerHTML=`<h3>Gotowe.</h3>
      <p class="helper">Kategoria: <strong>${esc(draft.category==="other"?(draft.customCategory||"Inne"):catLabel(draft.category))}</strong><br>
      Estymacja: <strong>${formatEstimate(draft.estimateMinutes)}</strong><br><br>
      Status po zapisaniu: <strong>Niezaplanowane</strong>. Dopiero blok w kalendarzu zamienia to w realny plan.</p>`;
  }

  $$("[data-cat]").forEach(b=>b.onclick=()=>{
    if(draft.category==="other" && $("#customCategory")) draft.customCategory=$("#customCategory").value;
    draft.category=b.dataset.cat;renderTaskStep();
  });
  if($("#customCategory")) $("#customCategory").oninput=e=>draft.customCategory=e.target.value;

  $$("[data-pr]").forEach(b=>b.onclick=()=>{draft.priority=b.dataset.pr;renderTaskStep()});

  $$("[data-duration]").forEach(b=>b.onclick=()=>{
    const v=b.dataset.duration;
    if(v==="unknown"){draft.estimateMinutes=null;draft.customDuration=false}
    else if(v==="custom"){draft.customDuration=true;draft.estimateMinutes=null}
    else{draft.estimateMinutes=Number(v);draft.customDuration=false}
    renderTaskStep();
  });

  if($("#customDurationValue")){
    const updateCustom=()=>{
      const value=Number($("#customDurationValue").value);
      if(!value){draft.estimateMinutes=null;return}
      draft.estimateMinutes=$("#customDurationUnit").value==="hours" ? Math.round(value*60) : Math.round(value);
    };
    $("#customDurationValue").oninput=updateCustom;
    $("#customDurationUnit").onchange=updateCustom;
  }

  $("#taskBack").style.visibility=taskStep===0?"hidden":"visible";
  $("#taskNext").textContent=taskStep===4?"Zapisz":"Dalej";
}


const QUARTER_PX=24;
const DAY_MINUTES=24*60;

function taskBlockMinutes(task){
  const raw=task.scheduledMinutes ?? task.estimateMinutes ?? 30;
  return Math.max(5,Number(raw)||30);
}
function minutesFromTime(time){
  const [h,m]=String(time).split(":").map(Number);
  return (h||0)*60+(m||0);
}
function timeFromMinutes(minutes){
  const safe=((Math.round(minutes)%DAY_MINUTES)+DAY_MINUTES)%DAY_MINUTES;
  return `${String(Math.floor(safe/60)).padStart(2,"0")}:${String(safe%60).padStart(2,"0")}`;
}
function snapMinutes(minutes,step=15){
  return Math.max(0,Math.min(DAY_MINUTES-5,Math.round(minutes/step)*step));
}
function pxFromMinutes(minutes){
  return minutes/15*QUARTER_PX;
}
function minutesFromPx(px){
  return px/QUARTER_PX*15;
}
function dateTimeIso(date,time){
  const [y,m,d]=date.split("-").map(Number);
  const [hh,mm]=time.split(":").map(Number);
  return new Date(y,m-1,d,hh,mm,0,0).toISOString();
}

let scheduleTaskId=null;
function openScheduleModal(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;
  scheduleTaskId=id;
  $("#scheduleTaskTitle").textContent=t.title;
  const parts=t.scheduledAt?localParts(t.scheduledAt):{date:todayKey,time:"09:00"};
  $("#scheduleDate").value=parts.date;
  $("#scheduleTime").value=parts.time;
  const mins=taskBlockMinutes(t);
  if(mins>=60 && mins%30===0){
    $("#scheduleDuration").value=mins/60;
    $("#scheduleDurationUnit").value="hours";
  }else{
    $("#scheduleDuration").value=mins;
    $("#scheduleDurationUnit").value="minutes";
  }
  $("#scheduleUnschedule").style.visibility=t.scheduledAt?"visible":"hidden";
  $("#scheduleModal").classList.remove("hidden");
}
function scheduleTaskExact(task,date,time,minutes){
  task.scheduledAt=dateTimeIso(date,time);
  task.scheduledMinutes=Math.max(5,Math.round(minutes));
  task.status="scheduled";
}
$("#scheduleCancel").onclick=()=>$("#scheduleModal").classList.add("hidden");
$("#scheduleSave").onclick=()=>{
  const t=state.tasks.find(x=>x.id===scheduleTaskId);if(!t)return;
  const date=$("#scheduleDate").value,time=$("#scheduleTime").value;
  const raw=Number($("#scheduleDuration").value);
  if(!date||!time||!raw){toast("Uzupełnij datę, start i długość.");return}
  const mins=$("#scheduleDurationUnit").value==="hours"?Math.round(raw*60):Math.round(raw);
  scheduleTaskExact(t,date,time,mins);
  save();$("#scheduleModal").classList.add("hidden");renderAll();toast("Timeblock zapisany.");
};
$("#scheduleUnschedule").onclick=()=>{
  const t=state.tasks.find(x=>x.id===scheduleTaskId);if(!t)return;
  t.scheduledAt=null;t.scheduledMinutes=null;t.status="unscheduled";
  save();$("#scheduleModal").classList.add("hidden");renderAll();toast("Zadanie wróciło do niezaplanowanych.");
};

function unscheduleTask(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;
  t.scheduledAt=null;t.scheduledMinutes=null;t.status="unscheduled";
  save();renderAll();toast("Odplanowano.");
}

/* task/calendar completion */
function completeTask(id){
  const t=state.tasks.find(x=>x.id===id);if(!t||done(t))return;
  t.completedAt=new Date().toISOString();t.status="done";
  const gain=xpForTask(t);state.xp=(state.xp||0)+gain;
  state.proof.unshift({id:uuid(),date:todayKey,text:`Ukończone: ${t.title}`,source:"task",createdAt:new Date().toISOString()});
  addDailyLog("tasks","Ukończono zadanie",`${t.title} · +${gain} XP`,{taskId:t.id,xp:gain});
  save();renderAll();toast(`+${gain} XP · zadanie ukończone`);
}

/* render */
function renderAll(){renderToday();renderTasks();renderWeek();renderMoney();renderProjects();renderBody();renderProof();renderReviews();renderIdeas();renderLogList("#todayLogs");renderLogList("#financeLogs","finance");renderLogList("#bodyLogs","body");renderLogList("#projectsLogs","projects");if(activeProjectId)renderProjectWorkspace();if(activeTaskDetailId)renderTaskDetail()}
function renderToday(){
  const d=ensureDay();$("#todayDate").textContent=new Date().toLocaleDateString("pl-PL",{weekday:"long",day:"numeric",month:"long"}).toUpperCase();
  $("#modeStat").textContent=d.capacity.mode==="full"?"Pełny":d.capacity.mode==="survival"?"Minimalny":"Standardowy";
  $("#capacityStat").textContent=(d.capacity.percent||0)+"%";$("#streakStat").textContent=state.streak||0;$("#capacityTitle").textContent=d.capacity.label||"Dzisiaj robimy dzień standardowy.";$("#capacityCopy").textContent=d.capacity.copy||"";
  $("#capacityMeta").innerHTML=`<span>Energia rano ${d.interview.energy}/10</span>${d.currentEnergy?`<span>Energia teraz ${d.currentEnergy}/10</span>`:""}<span>Sen ${d.interview.sleepHours} h</span><span>${d.interview.availableHours} h pracy</span>${d.capacity.updatedAt?`<span>Tempo zmienione ${formatLogTime(d.capacity.updatedAt)}</span>`:""}`;
  const lvl=getLevelInfo(state.xp||0);$("#levelName").textContent=`Level ${lvl.level} · ${lvl.title}`;$("#levelFinance").textContent=lvl.finance;$("#levelBar").style.width=lvl.progress+"%";$("#levelXp").textContent=lvl.next?`${lvl.currentXp} / ${lvl.needed} XP`:"MAX LEVEL";$("#actualCash").textContent=`Realne cash: ${finance().cash||"0 zł"}`;
  const top=$("#top3Grid");top.innerHTML="";d.top3.forEach((v,i)=>{const el=document.createElement("div");el.className="outcome";el.innerHTML=`<b>${i+1}</b><div><label>Wynik ${i+1}</label><input value="${esc(v)}" placeholder="Co ma być prawdą pod koniec dnia?"></div>`;el.querySelector("input").oninput=e=>{d.top3[i]=e.target.value};top.appendChild(el)});
  const cal=$("#todayCalendar");
  cal.innerHTML=`<div class="timeline"><div class="timeline-labels"></div><div class="timeline-canvas"></div></div>`;
  const labels=cal.querySelector(".timeline-labels"),canvas=cal.querySelector(".timeline-canvas");

  for(let h=0;h<24;h++){
    const label=document.createElement("div");
    label.className="timeline-hour";
    label.style.top=pxFromMinutes(h*60)+"px";
    label.textContent=`${String(h).padStart(2,"0")}:00`;
    labels.appendChild(label);
  }

  canvas.ondragover=e=>{e.preventDefault();canvas.classList.add("drag")};
  canvas.ondragleave=()=>canvas.classList.remove("drag");
  canvas.ondrop=e=>{
    e.preventDefault();canvas.classList.remove("drag");
    const id=e.dataTransfer.getData("text/plain"),t=state.tasks.find(x=>x.id===id);
    if(!t||done(t))return;
    const rect=canvas.getBoundingClientRect();
    const y=e.clientY-rect.top;
    const start=snapMinutes(minutesFromPx(y),15);
    t.scheduledAt=dateTimeIso(todayKey,timeFromMinutes(start));
    t.scheduledMinutes=taskBlockMinutes(t);
    t.status="scheduled";
    save();renderAll();toast(`Przeniesiono na ${timeFromMinutes(start)}`);
  };

  const todays=state.tasks
    .filter(t=>t.scheduledAt&&localParts(t.scheduledAt).date===todayKey&&!done(t))
    .sort((x,y)=>new Date(x.scheduledAt)-new Date(y.scheduledAt));

  for(const t of todays){
    const start=minutesFromTime(localParts(t.scheduledAt).time);
    const duration=taskBlockMinutes(t);
    const block=document.createElement("div");
    block.className="timeblock";
    block.draggable=true;
    block.style.top=pxFromMinutes(start)+"px";
    block.style.height=Math.max(24,pxFromMinutes(duration))+"px";
    block.innerHTML=`<strong>${esc(t.title)}</strong>
      <small>${localParts(t.scheduledAt).time} · ${formatEstimate(duration)} · ${esc(customCategoryLabel(t.category))}</small>
      <div class="timeblock-actions">
        <button class="block-icon edit-block" title="Edytuj blok">···</button>
        <button class="block-icon complete-block" title="Ukończ">✓</button>
      </div>
      <div class="resize-handle" title="Przeciągnij, aby zmienić długość"></div>`;

    block.ondragstart=e=>{
      if(e.target.closest(".resize-handle")||e.target.closest("button")){e.preventDefault();return}
      e.dataTransfer.setData("text/plain",t.id);
    };
    block.querySelector(".edit-block").onclick=e=>{e.stopPropagation();openScheduleModal(t.id)};
    block.querySelector(".complete-block").onclick=e=>{e.stopPropagation();completeTask(t.id)};
    block.ondblclick=e=>{if(e.target.closest("button,.resize-handle"))return;e.stopPropagation();openTaskDetail(t.id)};

    const handle=block.querySelector(".resize-handle");
    handle.onpointerdown=e=>{
      e.preventDefault();e.stopPropagation();
      handle.setPointerCapture?.(e.pointerId);
      const startY=e.clientY,startDuration=taskBlockMinutes(t);
      const move=ev=>{
        const deltaMinutes=minutesFromPx(ev.clientY-startY);
        const next=Math.max(5,Math.round((startDuration+deltaMinutes)/5)*5);
        block.style.height=Math.max(24,pxFromMinutes(next))+"px";
        block.querySelector("small").textContent=`${localParts(t.scheduledAt).time} · ${formatEstimate(next)} · ${customCategoryLabel(t.category)}`;
        block.dataset.liveDuration=String(next);
      };
      const up=()=>{
        document.removeEventListener("pointermove",move);
        document.removeEventListener("pointerup",up);
        const next=Number(block.dataset.liveDuration||startDuration);
        t.scheduledMinutes=next;
        save();renderAll();toast(`Blok: ${formatEstimate(next)}`);
      };
      document.addEventListener("pointermove",move);
      document.addEventListener("pointerup",up,{once:true});
    };
    canvas.appendChild(block);
  }

  // Scroll roughly to the first block / morning area.
  requestAnimationFrame(()=>{
    const first=todays[0];
    const target=first?minutesFromTime(localParts(first.scheduledAt).time):8*60;
    cal.scrollTop=Math.max(0,pxFromMinutes(target)-80);
  });
  const uns=$("#unscheduledList");uns.innerHTML="";
  const list=state.tasks.filter(t=>!done(t)&&!t.scheduledAt).slice(0,7);
  if(!list.length)uns.innerHTML='<div class="helper">Brak niezaplanowanych zadań.</div>';
  for(const t of list){
    const el=document.createElement("div");
    el.className="unscheduled task-clickable";el.draggable=true;el.dataset.taskOpen=t.id;
    el.innerHTML=`<strong>${esc(t.title)}</strong>
      <small>${esc(customCategoryLabel(t.category))} · ${t.priority} · ${formatEstimate(t.estimateMinutes)}</small>
      <span class="badge">Niezaplanowane</span>
      <div class="unscheduled-actions">
        <button class="btn ghost plan-task">Zaplanuj</button>
        <button class="btn ghost finish-task">Ukończ</button>
      </div>`;
    el.ondragstart=e=>{if(e.target.closest("button")){e.preventDefault();return}e.dataTransfer.setData("text/plain",t.id)};
    el.querySelector(".plan-task").onclick=()=>openScheduleModal(t.id);
    el.querySelector(".finish-task").onclick=()=>completeTask(t.id);
    el.onclick=e=>{if(e.target.closest("button"))return;openTaskDetail(t.id)};
    uns.appendChild(el);
  }
  $("#moneyMove").value=d.moneyMove||"";$("#moneyMove").oninput=e=>{$("#moneyMoveFinance").value=e.target.value};
  $$("[data-min]").forEach(i=>{i.checked=!!d.minimums[i.dataset.min]});
}

$("#saveTop3").onclick=()=>{
  const d=ensureDay();
  addDailyLog("top3","Zapisano 3 wyniki dnia",d.top3.filter(Boolean).join(" · "),{top3:[...d.top3]});
  save();renderLogList("#todayLogs");toast("Wyniki dnia zapisane.");
};

$("#clearToday").onclick=()=>{state.tasks.forEach(t=>{if(t.scheduledAt&&localParts(t.scheduledAt).date===todayKey&&!done(t)){t.scheduledAt=null;t.scheduledMinutes=null;t.status="unscheduled"}});save();renderAll()};


$("#saveMoneyMove").onclick=()=>{
  ensureDay().moneyMove=$("#moneyMove").value.trim();
  $("#moneyMoveFinance").value=ensureDay().moneyMove;
  addDailyLog("money","Zapisano ruch finansowy",ensureDay().moneyMove,{moneyMove:ensureDay().moneyMove});
  save();renderAll();toast("Ruch finansowy zapisany.");
};
$("#saveMoneyMoveFinance").onclick=()=>{
  ensureDay().moneyMove=$("#moneyMoveFinance").value.trim();
  $("#moneyMove").value=ensureDay().moneyMove;
  addDailyLog("money","Zapisano ruch finansowy",ensureDay().moneyMove,{moneyMove:ensureDay().moneyMove});
  save();renderAll();toast("Ruch finansowy zapisany.");
};
$("#saveMinimums").onclick=()=>{
  $$("[data-min]").forEach(i=>ensureDay().minimums[i.dataset.min]=i.checked);
  const m=ensureDay().minimums;
  addDailyLog("minimums","Zapisano podstawy dnia",[
    m.eat?"jedzenie ✓":"jedzenie —",m.water?"woda ✓":"woda —",
    m.movement?"ruch ✓":"ruch —",m.moneyAction?"ruch finansowy ✓":"ruch finansowy —"
  ].join(" · "),{...m});
  save();renderAll();toast("Podstawy dnia zapisane.");
};

async function deleteTask(id){
  state.tasks=state.tasks.filter(t=>t.id!==id);
  persistLocal(state);
  renderAll();
  if(cloudReady&&user){
    try{
      await deleteTaskRow(id);
      seedSyncFingerprints(state);
      syncStatus("zsynchronizowano");
    }catch(e){
      console.error(e);
      syncStatus("błąd usuwania");
      toast("Usunięto lokalnie, ale chmura nie odpowiedziała.");
      return;
    }
  }
  toast("Zadanie usunięte.");
}

function renderTasks(){
  $("#unscheduledCount").textContent=state.tasks.filter(t=>!done(t)&&!t.scheduledAt).length;
  $("#scheduledCount").textContent=state.tasks.filter(scheduled).length;
  $("#p1Count").textContent=state.tasks.filter(t=>!done(t)&&t.priority==="P1").length;
  $("#doneCount").textContent=state.tasks.filter(done).length;

  const cf=$("#categoryFilter"),old=cf.value||"all";
  const customCats=[...new Set(state.tasks.map(t=>t.category).filter(c=>c?.startsWith("custom:")))];
  cf.innerHTML='<option value="all">Wszystkie kategorie</option>'+
    categories.filter(c=>c.id!=="other").map(c=>`<option value="${c.id}">${c.label}</option>`).join("")+
    customCats.map(c=>`<option value="${esc(c)}">${esc(customCategoryLabel(c))}</option>`).join("");
  cf.value=[...cf.options].some(o=>o.value===old)?old:"all";

  const sf=$("#statusFilter").value,pf=cf.value;
  let list=[...state.tasks];
  if(sf==="open")list=list.filter(t=>!done(t));
  if(sf==="unscheduled")list=list.filter(t=>!done(t)&&!t.scheduledAt);
  if(sf==="scheduled")list=list.filter(scheduled);
  if(sf==="done")list=list.filter(done);
  if(pf!=="all")list=list.filter(t=>t.category===pf);

  $("#tasksTable").innerHTML=list.map(t=>{
    const block=t.scheduledAt
      ? `${new Date(t.scheduledAt).toLocaleString("pl-PL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})} · ${formatEstimate(taskBlockMinutes(t))}`
      : "Niezaplanowane";
    const actions=done(t)
      ? `<button class="btn ghost" data-delete="${t.id}">Usuń</button>`
      : `<button class="btn ghost" data-complete="${t.id}">Ukończ</button>
         <button class="btn ghost" data-plan="${t.id}">${t.scheduledAt?"Edytuj blok":"Zaplanuj"}</button>
         ${t.scheduledAt?`<button class="btn ghost" data-unschedule="${t.id}">Odplanuj</button>`:""}
         <button class="btn ghost" data-delete="${t.id}">Usuń</button>`;
    return `<div class="task-row task-clickable ${done(t)?"completed-row":""}" data-task-open="${t.id}">
      <div><strong>${esc(t.title)}</strong><br><span>${esc(customCategoryLabel(t.category))}</span>${checklistMini(t)}</div>
      <span>${t.priority}</span>
      <span>${formatEstimate(t.estimateMinutes)}</span>
      <span>${block}</span>
      <div class="task-actions">${actions}</div>
    </div>`;
  }).join("")||'<div class="helper" style="padding:16px">Brak zadań.</div>';

  $$("[data-complete]").forEach(b=>b.onclick=()=>completeTask(b.dataset.complete));
  $$("[data-plan]").forEach(b=>b.onclick=()=>openScheduleModal(b.dataset.plan));
  $$("[data-unschedule]").forEach(b=>b.onclick=()=>unscheduleTask(b.dataset.unschedule));
  $$("[data-delete]").forEach(b=>b.onclick=()=>deleteTask(b.dataset.delete));
  wireTaskDetailOpeners($("#tasksTable"));
}
$("#statusFilter").onchange=renderTasks;$("#categoryFilter").onchange=renderTasks;

function renderWeek(){
  const root=$("#weekGrid");root.innerHTML="";const now=new Date(),dn=now.getDay()||7,monday=new Date(now);monday.setHours(0,0,0,0);monday.setDate(now.getDate()-dn+1);
  for(let i=0;i<7;i++){const d=new Date(monday);d.setDate(monday.getDate()+i);const key=dateKey(d),tasks=state.tasks.filter(t=>scheduled(t)&&localParts(t.scheduledAt).date===key).sort((a,b)=>new Date(a.scheduledAt)-new Date(b.scheduledAt));root.innerHTML+=`<div class="week-day ${key===todayKey?"today":""}"><div class="week-head"><strong>${d.toLocaleDateString("pl-PL",{weekday:"short"})}</strong><span>${d.toLocaleDateString("pl-PL",{day:"numeric",month:"short"})}</span></div><div class="week-body">${tasks.map(t=>`<div class="week-task"><strong>${localParts(t.scheduledAt).time} · ${formatEstimate(taskBlockMinutes(t))}</strong><br>${esc(t.title)}</div>`).join("")||'<span class="helper">Brak bloków</span>'}</div></div>`}
}
function renderMoney(){
  const f=finance(),defs=[["cash","Dostępna gotówka"],["protected","Środki chronione"],["incoming","Spodziewane wpływy"],["bills","Wydatki 7 dni"],["revenueToday","Przychód dziś"],["revenueMonth","Przychód miesiąca"]];
  $("#financeGrid").innerHTML=defs.map(([k,l])=>`<div class="panel finance-card"><span>${l}</span><input data-fin="${k}" value="${esc(f[k])}"></div>`).join("");
  $("#moneyMoveFinance").value=ensureDay().moneyMove||"";$("#moneyMoveFinance").oninput=e=>{$("#moneyMove").value=e.target.value}
}

$("#saveFinance").onclick=()=>{
  const f=finance();
  $$("[data-fin]").forEach(i=>f[i.dataset.fin]=i.value);
  addDailyLog("finance","Zapisano stan finansów",
    `Cash ${f.cash} · chronione ${f.protected} · wpływy ${f.incoming} · wydatki 7 dni ${f.bills}`,
    {...f});
  save();renderAll();toast("Finanse zapisane.");
};



/* TASK DETAIL WORKSPACE */
let activeTaskDetailId=null;

function taskChecklist(task){
  if(!Array.isArray(task.checklist)) task.checklist=[];
  return task.checklist;
}
function checklistStats(task){
  const list=taskChecklist(task);
  const doneCount=list.filter(x=>x.done).length;
  return {total:list.length,done:doneCount,pct:list.length?Math.round(doneCount/list.length*100):0};
}
function checklistMini(task){
  const s=checklistStats(task);
  if(!s.total)return "";
  return `<div class="task-checklist-mini"><span>${s.done}/${s.total}</span><div class="task-checklist-mini-bar"><span style="width:${s.pct}%"></span></div><span>${s.pct}%</span></div>`;
}

function openTaskDetail(id){
  const t=state.tasks.find(x=>x.id===id); if(!t)return;
  activeTaskDetailId=id;
  $("#taskDetailModal").classList.remove("hidden");
  renderTaskDetail();
}

function closeTaskDetail(){
  $("#taskDetailModal").classList.add("hidden");
  activeTaskDetailId=null;
}

$("#taskDetailClose").onclick=closeTaskDetail;
$("#taskDetailModal").onclick=e=>{
  if(e.target.id==="taskDetailModal")closeTaskDetail();
};

function renderTaskDetail(){
  const t=state.tasks.find(x=>x.id===activeTaskDetailId);
  if(!t){closeTaskDetail();return}

  $("#taskDetailTitle").value=t.title||"";
  $("#taskDetailPriority").value=t.priority||"P2";
  $("#taskDetailDueDate").value=t.dueDate||"";
  $("#taskDetailNotes").value=t.notes||"";
  $("#taskDetailLink").value=t.linkUrl||"";

  const mins=t.estimateMinutes;
  if(mins==null){
    $("#taskDetailEstimate").value="";
    $("#taskDetailEstimateUnit").value="minutes";
  }else if(mins>=60 && mins%30===0){
    $("#taskDetailEstimate").value=mins/60;
    $("#taskDetailEstimateUnit").value="hours";
  }else{
    $("#taskDetailEstimate").value=mins;
    $("#taskDetailEstimateUnit").value="minutes";
  }

  const parts=[];
  parts.push(`<span class="task-detail-meta-chip">${esc(customCategoryLabel(t.category))}</span>`);
  parts.push(`<span class="task-detail-meta-chip">${esc(t.priority)}</span>`);
  parts.push(`<span class="task-detail-meta-chip">${done(t)?"Done":t.scheduledAt?"Planned":"Backlog"}</span>`);
  if(t.scheduledAt) parts.push(`<span class="task-detail-meta-chip">${new Date(t.scheduledAt).toLocaleString("pl-PL",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</span>`);
  $("#taskDetailMeta").innerHTML=parts.join("");

  $("#taskDetailComplete").classList.toggle("hidden",done(t));
  $("#taskDetailSchedule").textContent=t.scheduledAt?"Edytuj timeblock":"Zaplanuj";

  const link=(t.linkUrl||"").trim();
  $("#taskDetailLinkOpenWrap").classList.toggle("hidden",!link);
  if(link) $("#taskDetailLinkOpen").href=link;

  renderTaskChecklist();
}

function renderTaskChecklist(){
  const t=state.tasks.find(x=>x.id===activeTaskDetailId); if(!t)return;
  const list=taskChecklist(t), s=checklistStats(t);

  $("#taskChecklistProgressLabel").textContent=`${s.done} / ${s.total} ukończone`;
  $("#taskChecklistPercent").textContent=`${s.pct}%`;
  $("#taskChecklistProgressBar").style.width=`${s.pct}%`;

  const root=$("#taskChecklistList");
  if(!list.length){
    root.innerHTML='<div class="helper" style="padding:12px 0">Brak kroków. Rozbij task na mniejsze rzeczy do odhaczenia.</div>';
    return;
  }

  const open=list.filter(x=>!x.done);
  const completed=list.filter(x=>x.done);

  const itemHtml=(item,i,sourceList)=>`
    <div class="task-check-item ${item.done?"done":""}" data-check-id="${item.id}">
      <input class="task-check-box" type="checkbox" ${item.done?"checked":""} data-check-toggle="${item.id}">
      <div class="task-check-copy">
        <span class="task-check-label">${esc(item.text||"Bez nazwy")}</span>
        ${item.done?'<small>Ukończone</small>':""}
      </div>
      <div class="task-check-actions">
        <button data-check-edit="${item.id}" title="Edytuj">✎</button>
        <button data-check-up="${item.id}" title="W górę" ${sourceList.indexOf(item)===0?"disabled":""}>↑</button>
        <button data-check-down="${item.id}" title="W dół" ${sourceList.indexOf(item)===sourceList.length-1?"disabled":""}>↓</button>
        <button class="delete" data-check-delete="${item.id}" title="Usuń">×</button>
      </div>
    </div>`;

  root.innerHTML=`
    <div class="task-check-section">
      <div class="task-check-section-head">
        <strong>Do zrobienia</strong>
        <span>${open.length}</span>
      </div>
      <div class="task-check-section-list">
        ${open.length?open.map((item,i)=>itemHtml(item,i,open)).join(""):'<div class="task-check-empty">Wszystkie kroki ukończone 🎉</div>'}
      </div>
    </div>

    <details class="task-check-completed" ${completed.length?"open":""}>
      <summary>
        <span>Ukończone</span>
        <b>${completed.length}</b>
      </summary>
      <div class="task-check-section-list">
        ${completed.length?completed.map((item,i)=>itemHtml(item,i,completed)).join(""):'<div class="task-check-empty">Jeszcze nic nie ukończono.</div>'}
      </div>
    </details>`;

  $$("[data-check-toggle]").forEach(el=>el.onchange=()=>{
    const item=list.find(x=>x.id===el.dataset.checkToggle); if(!item)return;
    item.done=el.checked;
    item.completedAt=el.checked ? new Date().toISOString() : null;
    save();
    renderTaskChecklist();
    renderAll();
  });

  $$("[data-check-edit]").forEach(el=>el.onclick=()=>{
    const item=list.find(x=>x.id===el.dataset.checkEdit); if(!item)return;
    const next=prompt("Edytuj subtask",item.text||"");
    if(next===null)return;
    const clean=next.trim();
    if(!clean)return;
    item.text=clean;
    save();
    renderTaskChecklist();
    renderAll();
  });

  $$("[data-check-delete]").forEach(el=>el.onclick=()=>{
    const index=list.findIndex(x=>x.id===el.dataset.checkDelete); if(index<0)return;
    list.splice(index,1);
    save();
    renderTaskChecklist();
    renderAll();
  });

  $$("[data-check-up]").forEach(el=>el.onclick=()=>{
    const id=el.dataset.checkUp;
    const group=list.filter(x=>x.done===list.find(y=>y.id===id)?.done);
    const gi=group.findIndex(x=>x.id===id); if(gi<=0)return;
    const a=list.findIndex(x=>x.id===group[gi-1].id);
    const b=list.findIndex(x=>x.id===id);
    [list[a],list[b]]=[list[b],list[a]];
    save();renderTaskChecklist();renderAll();
  });

  $$("[data-check-down]").forEach(el=>el.onclick=()=>{
    const id=el.dataset.checkDown;
    const current=list.find(y=>y.id===id); if(!current)return;
    const group=list.filter(x=>x.done===current.done);
    const gi=group.findIndex(x=>x.id===id); if(gi<0||gi>=group.length-1)return;
    const a=list.findIndex(x=>x.id===id);
    const b=list.findIndex(x=>x.id===group[gi+1].id);
    [list[a],list[b]]=[list[b],list[a]];
    save();renderTaskChecklist();renderAll();
  });
}

function addChecklistItem(){
  const t=state.tasks.find(x=>x.id===activeTaskDetailId); if(!t)return;
  const input=$("#taskChecklistNew");
  const text=input.value.trim(); if(!text)return;
  taskChecklist(t).push({id:uuid(),text,done:false,completedAt:null});
  input.value="";
  save();renderTaskChecklist();renderAll();
  setTimeout(()=>input.focus(),10);
}
$("#taskChecklistAdd").onclick=addChecklistItem;
$("#taskChecklistNew").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();addChecklistItem()}};

$("#taskDetailSave").onclick=()=>{
  const t=state.tasks.find(x=>x.id===activeTaskDetailId); if(!t)return;

  const title=$("#taskDetailTitle").value.trim();
  if(!title){toast("Task musi mieć nazwę.");return}

  const raw=$("#taskDetailEstimate").value.trim();
  let estimateMinutes=null;
  if(raw!==""){
    const n=Number(raw);
    if(!Number.isFinite(n)||n<=0){toast("Estymacja musi być większa od zera albo pusta.");return}
    estimateMinutes=$("#taskDetailEstimateUnit").value==="hours"?Math.round(n*60):Math.round(n);
  }

  t.title=title;
  t.priority=$("#taskDetailPriority").value;
  t.estimateMinutes=estimateMinutes;
  t.dueDate=$("#taskDetailDueDate").value||null;
  t.notes=$("#taskDetailNotes").value.trim();
  t.linkUrl=$("#taskDetailLink").value.trim();

  save();
  renderAll();
  renderTaskDetail();
  toast("Task zapisany.");
};

$("#taskDetailSchedule").onclick=()=>{
  const id=activeTaskDetailId;
  if(!id)return;
  openScheduleModal(id);
};

$("#taskDetailComplete").onclick=()=>{
  const id=activeTaskDetailId;
  if(!id)return;
  completeTask(id);
  renderTaskDetail();
};

$("#taskDetailDelete").onclick=async()=>{
  const t=state.tasks.find(x=>x.id===activeTaskDetailId); if(!t)return;
  if(!confirm(`Usunąć task „${t.title}”?`))return;
  const id=t.id;
  closeTaskDetail();
  await deleteTask(id);
};

/* Clickable task helpers */
function wireTaskDetailOpeners(root=document){
  root.querySelectorAll("[data-task-open]").forEach(el=>{
    el.onclick=e=>{
      if(e.target.closest("button,input,select,a,textarea"))return;
      openTaskDetail(el.dataset.taskOpen);
    };
  });
}



let activeProjectId=null;
let activeProjectTab="overview";
let projectTaskEditId=null;

function projectTasks(id){
  return state.tasks.filter(t=>{
    const cat=String(t.category||"");
    return cat===id || cat===`custom:${id}` || customCategoryLabel(cat)===state.projects[id]?.label;
  });
}

function projectStats(id){
  const tasks=projectTasks(id);
  const doneCount=tasks.filter(done).length;
  const planned=tasks.filter(t=>!done(t)&&!!t.scheduledAt).length;
  const backlog=tasks.filter(t=>!done(t)&&!t.scheduledAt).length;
  const pct=tasks.length?Math.round(doneCount/tasks.length*100):0;
  return {tasks,doneCount,planned,backlog,pct};
}

function renderProjects(){
  const entries=Object.entries(state.projects);
  $("#projectsGrid").innerHTML=entries.map(([id,p])=>{
    const s=projectStats(id);
    return `<div class="panel content-card project-card" data-project-open="${id}">
      <div>
        <small>Projekt</small>
        <h3>${esc(p.label)}</h3>
        <div class="project-stats-mini">
          <span>${s.backlog} backlog</span>
          <span>${s.planned} planned</span>
          <span>${s.doneCount} done</span>
        </div>
        <div class="project-progress"><span style="width:${s.pct}%"></span></div>
        <p class="helper" style="margin-top:8px">${s.tasks.length ? `${s.pct}% ukończone · ${s.tasks.length} tasków` : "Brak tasków — wejdź do workspace i dodaj pierwszy."}</p>
      </div>
      <div class="project-card-footer">
        <button class="btn primary" data-project-open-btn="${id}">Otwórz workspace</button>
      </div>
    </div>`;
  }).join("");

  $$("[data-project-open-btn]").forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    openProjectWorkspace(b.dataset.projectOpenBtn);
  });

  $$("[data-project-open]").forEach(card=>card.onclick=e=>{
    if(e.target.closest("button"))return;
    openProjectWorkspace(card.dataset.projectOpen);
  });
}

function openProjectWorkspace(id){
  if(!state.projects[id])return;
  activeProjectId=id;
  activeProjectTab="overview";
  $("#projectWorkspaceModal").classList.remove("hidden");
  renderProjectWorkspace();
}

function closeProjectWorkspace(){
  $("#projectWorkspaceModal").classList.add("hidden");
  activeProjectId=null;
}

$("#projectWorkspaceClose").onclick=closeProjectWorkspace;
$("#projectWorkspaceModal").onclick=e=>{
  if(e.target.id==="projectWorkspaceModal")closeProjectWorkspace();
};

$$("[data-project-tab]").forEach(b=>b.onclick=()=>{
  activeProjectTab=b.dataset.projectTab;
  renderProjectWorkspace();
});

function openProjectTaskModal(taskId=null){
  if(!activeProjectId)return;
  projectTaskEditId=taskId;
  const t=taskId ? state.tasks.find(x=>x.id===taskId) : null;

  $("#projectTaskModalTitle").textContent=t?"Edytuj task":"Dodaj task";
  $("#projectTaskEyebrow").textContent=`${state.projects[activeProjectId].label.toUpperCase()} · TASK`;
  $("#projectTaskTitle").value=t?.title||"";
  $("#projectTaskPriority").value=t?.priority||"P2";

  const mins=t?.estimateMinutes;
  if(mins==null){
    $("#projectTaskEstimate").value="";
    $("#projectTaskEstimateUnit").value="minutes";
  }else if(mins>=60 && mins%30===0){
    $("#projectTaskEstimate").value=mins/60;
    $("#projectTaskEstimateUnit").value="hours";
  }else{
    $("#projectTaskEstimate").value=mins;
    $("#projectTaskEstimateUnit").value="minutes";
  }

  $("#projectTaskDelete").classList.toggle("hidden",!t);
  $("#projectTaskModal").classList.remove("hidden");
  setTimeout(()=>$("#projectTaskTitle").focus(),20);
}

$("#projectAddTask").onclick=()=>openProjectTaskModal();
$("#projectTaskCancel").onclick=()=>$("#projectTaskModal").classList.add("hidden");

$("#projectTaskSave").onclick=()=>{
  if(!activeProjectId)return;
  const title=$("#projectTaskTitle").value.trim();
  if(!title){toast("Wpisz nazwę taska.");return}

  const raw=$("#projectTaskEstimate").value.trim();
  let estimateMinutes=null;
  if(raw!==""){
    const n=Number(raw);
    if(!Number.isFinite(n)||n<=0){toast("Estymacja musi być większa od zera albo pusta.");return}
    estimateMinutes=$("#projectTaskEstimateUnit").value==="hours" ? Math.round(n*60) : Math.round(n);
  }

  if(projectTaskEditId){
    const t=state.tasks.find(x=>x.id===projectTaskEditId);
    if(!t)return;
    t.title=title;
    t.priority=$("#projectTaskPriority").value;
    t.estimateMinutes=estimateMinutes;
    t.category=activeProjectId;
  }else{
    state.tasks.unshift({
      id:uuid(),
      title,
      category:activeProjectId,
      priority:$("#projectTaskPriority").value,
      estimateMinutes,
      actualMinutes:null,
      scheduledAt:null,
      scheduledMinutes:null,
      completedAt:null,
      status:"unscheduled",
      notes:"",
      dueDate:null,
      linkUrl:"",
      checklist:[],
      createdAt:new Date().toISOString()
    });
  }

  save();
  $("#projectTaskModal").classList.add("hidden");
  projectTaskEditId=null;
  renderAll();
  toast("Task zapisany.");
};

$("#projectTaskDelete").onclick=async()=>{
  if(!projectTaskEditId)return;
  const t=state.tasks.find(x=>x.id===projectTaskEditId);
  if(!t)return;
  if(!confirm(`Usunąć task „${t.title}”?`))return;
  const id=projectTaskEditId;
  $("#projectTaskModal").classList.add("hidden");
  projectTaskEditId=null;
  await deleteTask(id);
  if(activeProjectId) renderProjectWorkspace();
};

function projectTaskActions(t){
  return `<div class="pm-task-actions">
    ${!done(t)?`<button class="pm-icon-btn" data-pm-plan="${t.id}" title="${t.scheduledAt?"Edytuj timeblock":"Zaplanuj"}">◷</button>`:""}
    <button class="pm-icon-btn" data-pm-edit="${t.id}" title="Edytuj task">✎</button>
    ${!done(t)?`<button class="pm-icon-btn" data-pm-done="${t.id}" title="Ukończ">✓</button>`:""}
    <button class="pm-icon-btn delete" data-pm-delete="${t.id}" title="Usuń">×</button>
  </div>`;
}

function projectTaskRow(t){
  return `<div class="pm-task-row task-clickable ${done(t)?"done":""}" data-task-open="${t.id}">
    <span class="pm-priority">${esc(t.priority)}</span>
    <div>
      <strong>${esc(t.title)}</strong>
      <small>${formatEstimate(t.estimateMinutes)}${t.dueDate?` · deadline ${new Date(t.dueDate+"T12:00:00").toLocaleDateString("pl-PL",{day:"2-digit",month:"short"})}`:""}${t.scheduledAt?` · ${new Date(t.scheduledAt).toLocaleString("pl-PL",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}`:""}</small>
      ${checklistMini(t)}
    </div>
    <span class="badge">${done(t)?"Done":t.scheduledAt?"Planned":"Backlog"}</span>
    ${projectTaskActions(t)}
  </div>`;
}

function wireProjectTaskActions(){
  $$("[data-pm-plan]").forEach(b=>b.onclick=()=>openScheduleModal(b.dataset.pmPlan));
  $$("[data-pm-edit]").forEach(b=>b.onclick=()=>openProjectTaskModal(b.dataset.pmEdit));
  $$("[data-pm-done]").forEach(b=>b.onclick=()=>completeTask(b.dataset.pmDone));
  $$("[data-pm-delete]").forEach(b=>b.onclick=()=>deleteTask(b.dataset.pmDelete));
  $$("[data-pm-add-empty]").forEach(b=>b.onclick=()=>openProjectTaskModal());
}

function kanbanCard(t){
  return `<div class="kanban-card task-clickable" data-task-open="${t.id}">
    <strong>${esc(t.title)}</strong>
    <small>${esc(t.priority)} · ${formatEstimate(t.estimateMinutes)}${t.dueDate?` · deadline ${new Date(t.dueDate+"T12:00:00").toLocaleDateString("pl-PL",{day:"2-digit",month:"short"})}`:""}${t.scheduledAt?` · ${new Date(t.scheduledAt).toLocaleString("pl-PL",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}`:""}</small>
    ${checklistMini(t)}
    <div class="kanban-card-actions">
      ${!done(t)?`<button class="btn ghost" data-pm-plan="${t.id}">${t.scheduledAt?"Timeblock":"Zaplanuj"}</button>`:""}
      <button class="btn ghost" data-pm-edit="${t.id}">Edytuj</button>
      ${!done(t)?`<button class="btn ghost" data-pm-done="${t.id}">Done</button>`:""}
      <button class="btn ghost" data-pm-delete="${t.id}">Usuń</button>
    </div>
  </div>`;
}

function projectEmpty(message="Brak tasków w tym projekcie."){
  return `<div class="pm-empty"><strong>${esc(message)}</strong><span>Dodaj pierwszy task bez wychodzenia z projektu.</span><br><button class="btn primary" data-pm-add-empty>+ Dodaj task</button></div>`;
}

function renderProjectWorkspace(){
  if(!activeProjectId||!state.projects[activeProjectId])return;

  const p=state.projects[activeProjectId];
  const s=projectStats(activeProjectId);

  $("#projectWorkspaceTitle").textContent=p.label;
  $("#projectWorkspaceMeta").textContent=`${s.pct}% ukończone · ${s.backlog} backlog · ${s.planned} planned · ${s.doneCount} done`;
  $$("[data-project-tab]").forEach(x=>x.classList.toggle("active",x.dataset.projectTab===activeProjectTab));

  const root=$("#projectWorkspaceBody");

  if(activeProjectTab==="overview"){
    const open=s.tasks.filter(t=>!done(t));
    const scheduled=[...open].filter(t=>t.scheduledAt).sort((a,b)=>new Date(a.scheduledAt)-new Date(b.scheduledAt));
    const priority=[...open].sort((a,b)=>String(a.priority).localeCompare(String(b.priority))).slice(0,6);

    root.innerHTML=`
      <div class="pm-overview-grid">
        <div>
          <div class="pm-stat-grid">
            <div class="pm-stat"><span>Progress</span><strong>${s.pct}%</strong></div>
            <div class="pm-stat"><span>Backlog</span><strong>${s.backlog}</strong></div>
            <div class="pm-stat"><span>Planned</span><strong>${s.planned}</strong></div>
            <div class="pm-stat"><span>Done</span><strong>${s.doneCount}</strong></div>
          </div>

          <div class="panel pm-recent">
            <div class="pm-toolbar">
              <div class="pm-toolbar-copy"><h3>Priorytety projektu</h3><p>Najważniejsze otwarte taski.</p></div>
              <button class="btn primary" data-pm-add-empty>+ Task</button>
            </div>
            <div class="pm-task-list">${priority.length?priority.map(projectTaskRow).join(""):projectEmpty()}</div>
          </div>
        </div>

        <div>
          <div class="panel">
            <div class="pm-toolbar-copy"><h3>Najbliżej w kalendarzu</h3><p>Zaplanowana praca dla projektu.</p></div>
            <div class="pm-task-list" style="margin-top:12px">
              ${scheduled.length?scheduled.slice(0,5).map(projectTaskRow).join(""):'<div class="helper">Nic nie jest jeszcze zaplanowane.</div>'}
            </div>
          </div>
        </div>
      </div>`;
  }

  if(activeProjectTab==="kanban"){
    const backlog=s.tasks.filter(t=>!done(t)&&!t.scheduledAt);
    const planned=s.tasks.filter(t=>!done(t)&&!!t.scheduledAt);
    const completed=s.tasks.filter(done);

    const col=(title,list,cls)=>`
      <div class="kanban-col">
        <div class="kanban-head">
          <div class="pm-board-label"><i class="pm-board-dot ${cls}"></i><h3>${title}</h3></div>
          <span class="kanban-count">${list.length}</span>
        </div>
        <div class="kanban-stack">
          ${list.length?list.map(kanbanCard).join(""):'<div class="helper">Pusto</div>'}
        </div>
      </div>`;

    root.innerHTML=`
      <div class="pm-toolbar">
        <div class="pm-toolbar-copy"><h3>Board</h3><p>Backlog → zaplanowane → ukończone.</p></div>
        <button class="btn primary" data-pm-add-empty>+ Dodaj task</button>
      </div>
      <div class="kanban-board">
        ${col("Backlog",backlog,"")}
        ${col("Planned",planned,"planned")}
        ${col("Done",completed,"done")}
      </div>`;
  }

  if(activeProjectTab==="list"){
    const list=[...s.tasks].sort((a,b)=>{
      if(done(a)!==done(b)) return done(a)?1:-1;
      return String(a.priority).localeCompare(String(b.priority));
    });

    root.innerHTML=`
      <div class="panel">
        <div class="pm-toolbar">
          <div class="pm-toolbar-copy"><h3>Wszystkie taski</h3><p>Edytuj, planuj, kończ lub usuwaj bez wychodzenia z projektu.</p></div>
          <button class="btn primary" data-pm-add-empty>+ Dodaj task</button>
        </div>
        <div class="pm-task-list">${list.length?list.map(projectTaskRow).join(""):projectEmpty()}</div>
      </div>`;
  }

  if(activeProjectTab==="timeline"){
    const list=s.tasks.filter(t=>t.scheduledAt).sort((a,b)=>new Date(a.scheduledAt)-new Date(b.scheduledAt));

    root.innerHTML=`
      <div class="panel">
        <div class="pm-toolbar">
          <div class="pm-toolbar-copy"><h3>Timeline</h3><p>Wszystkie timeblocki tego projektu.</p></div>
          <button class="btn primary" data-pm-add-empty>+ Dodaj task</button>
        </div>
        <div class="pm-timeline">
          ${list.length?list.map(t=>`
            <div class="pm-time-row">
              <div class="pm-time-date">${new Date(t.scheduledAt).toLocaleString("pl-PL",{weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
              <div><strong>${esc(t.title)}</strong><small>${esc(t.priority)} · ${formatEstimate(taskBlockMinutes(t))}</small></div>
              ${projectTaskActions(t)}
            </div>`).join(""):projectEmpty("Brak timeblocków dla tego projektu.")}
        </div>
      </div>`;
  }

  wireProjectTaskActions();
  wireTaskDetailOpeners(root);
}

function renderBody(){const b=body();$("#bodyEnergy").textContent=ensureDay().interview.energy;$("#bodyEnergyBar").style.width=(ensureDay().interview.energy*10)+"%";for(const [id,key] of [["bodySteps","steps"],["bodyWeight","weight"],["bodyWater","water"],["bodySleep","sleep"]]){$("#"+id).value=b[key]}$("#bodyWorkout").checked=!!b.workout}
$("#saveBody").onclick=()=>{
  const b=body();
  b.steps=$("#bodySteps").value;b.weight=$("#bodyWeight").value;b.water=$("#bodyWater").value;b.sleep=$("#bodySleep").value;b.workout=$("#bodyWorkout").checked;
  addDailyLog("body","Zapisano stan ciała",
    `${b.steps?b.steps+" kroków · ":""}${b.weight?b.weight+" kg · ":""}${b.water?b.water+" l wody · ":""}${b.sleep?b.sleep+" h snu · ":""}${b.workout?"trening/ruch ✓":"trening/ruch —"}`,
    {...b});
  save();renderAll();toast("Stan ciała zapisany.");
};
function renderProof(){const month=todayKey.slice(0,7);$("#proofCount").textContent=state.proof.length;$("#proofMonthCount").textContent=state.proof.filter(p=>String(p.date).startsWith(month)).length;$("#proofTasksCount").textContent=state.tasks.filter(done).length;$("#proofLevel").textContent=getLevelInfo(state.xp||0).level;$("#proofGrid").innerHTML=state.proof.map(p=>`<div class="panel content-card"><small>${p.date}</small><h3>${esc(p.text)}</h3></div>`).join("")||'<span class="helper">Brak dowodów.</span>'}
$("#addProof").onclick=()=>{const v=$("#proofInput").value.trim();if(!v)return;state.proof.unshift({id:uuid(),date:todayKey,text:v,source:"manual",createdAt:new Date().toISOString()});$("#proofInput").value="";save();renderProof()};
function renderReviews(){$("#reviewsGrid").innerHTML=state.reviews.map(r=>`<div class="panel content-card"><small>${r.date}</small><h3>${esc(r.done||"Przegląd dnia")}</h3><p class="helper"><b>Wniosek:</b> ${esc(r.learn||"—")}<br><b>Jutro:</b> ${esc(r.tomorrow||"—")}</p></div>`).join("")||'<span class="helper">Brak przeglądów.</span>'}
$("#addReview").onclick=()=>$("#reviewModal").classList.remove("hidden");$("#reviewCancel").onclick=()=>$("#reviewModal").classList.add("hidden");$("#reviewSave").onclick=()=>{const doneV=$("#reviewDone").value.trim(),learn=$("#reviewLearn").value.trim(),tom=$("#reviewTomorrow").value.trim();state.reviews.unshift({id:uuid(),date:todayKey,done:doneV,learn,tomorrow:tom,createdAt:new Date().toISOString()});if(doneV)state.proof.unshift({id:uuid(),date:todayKey,text:doneV,source:"review",createdAt:new Date().toISOString()});const y=new Date();y.setDate(y.getDate()-1);state.streak=state.lastReviewDate===dateKey(y)?(state.streak||0)+1:1;state.lastReviewDate=todayKey;save();$("#reviewModal").classList.add("hidden");renderAll()};
function renderIdeas(){$("#ideasGrid").innerHTML=state.ideas.map(x=>`<div class="panel content-card"><small>${esc(x.category)}</small><h3>${esc(x.title)}</h3><p class="helper">${esc(x.status)}</p></div>`).join("")||'<span class="helper">Schowek jest pusty.</span>'}
$("#ideaForm").onsubmit=e=>{e.preventDefault();const v=$("#ideaTitle").value.trim();if(!v)return;state.ideas.unshift({id:uuid(),title:v,category:$("#ideaCategory").value,status:"Zaparkowany",createdAt:new Date().toISOString()});$("#ideaTitle").value="";save();renderIdeas()};

window.addEventListener("online",()=>{syncStatus("online");save()});window.addEventListener("offline",()=>syncStatus("offline — zapis lokalny"));
ensureDay();renderAll();initAuth();


/* NEO v2 Hybrid gaming layer */
const neoMoney = (v)=>{
  const n=Number(String(v??"").replace(/[^\d,.-]/g,"").replace(",","."));
  if(!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pl-PL",{style:"currency",currency:"PLN",maximumFractionDigits:0}).format(n);
};

function neoTodayXp(){
  const today=todayKey;
  return state.tasks
    .filter(t=>t.completedAt && localParts(t.completedAt).date===today)
    .reduce((sum,t)=>sum+xpForTask(t),0);
}

function neoCurrentStreak(){
  let streak=0;
  let d=new Date();
  for(let i=0;i<365;i++){
    const key=d.toISOString().slice(0,10);
    const hasDone=state.tasks.some(t=>t.completedAt && localParts(t.completedAt).date===key);
    if(hasDone) streak++;
    else if(i===0){}
    else break;
    d.setDate(d.getDate()-1);
  }
  return streak;
}

function neoLevelInfo(){
  const xp=Number(state.xp||0);
  const rows = (typeof levelRows!=="undefined" && Array.isArray(levelRows)) ? levelRows : [];
  if(rows.length){
    let current=rows[0], next=rows[1]||null;
    rows.forEach((r,i)=>{ if(xp>=Number(r.minXP||r.minXp||r.min_xp||0)){ current=r; next=rows[i+1]||null; }});
    return {
      level:current.level||1,
      label:current.label||current.name||"Level",
      min:Number(current.minXP||current.minXp||current.min_xp||0),
      nextMin:next?Number(next.minXP||next.minXp||next.min_xp||0):Math.max(xp,1)
    };
  }
  return {level:1,label:"Stabilizacja",min:0,nextMin:100};
}

function renderGamingLayer(){
  const q=id=>document.getElementById(id);
  if(!q("gamingSummary")) return;

  const li=neoLevelInfo();
  q("gamingLevel").textContent=li.level;
  q("gamingRank").textContent=li.label;
  q("gamingTodayXp").textContent=`+${neoTodayXp()}`;
  q("gamingStreak").textContent=neoCurrentStreak();

  const doneToday=state.tasks.filter(t=>t.completedAt && localParts(t.completedAt).date===todayKey).length;
  q("gamingDone").textContent=doneToday;

  const day=state.days?.[todayKey]||{};
  const mode=day.dayMode||day.day_mode||"standard";
  const modeLabel={full:"Pełny",standard:"Standard",survival:"Minimalny"}[mode]||mode;
  const energy=day.currentEnergy ?? day.current_energy ?? day.energy ?? null;
  q("gamingCapacity").textContent=modeLabel;
  q("gamingEnergy").textContent=energy?`Energy ${energy}/10`:"current pace";

  const f=state.finance?.[todayKey] || state.financeSnapshots?.[todayKey] || state.finance || {};
  const cash=f.cash ?? "";
  const protectedV=f.protected ?? "";
  const incoming=f.incoming ?? "";
  const revToday=f.revenueToday ?? f.revenue_today ?? "";
  const revMonth=f.revenueMonth ?? f.revenue_month ?? "";

  q("gamingCash").textContent=neoMoney(cash);
  q("gamingWealthMain").textContent=neoMoney(cash);
  q("gamingProtected").textContent=neoMoney(protectedV);
  q("gamingIncoming").textContent=neoMoney(incoming);
  q("gamingRevenueToday").textContent=neoMoney(revToday);
  q("gamingRevenueMonth").textContent=neoMoney(revMonth);

  const cashNum=Number(String(cash??"").replace(/[^\d,.-]/g,"").replace(",","."))||0;
  const milestones=[500,1000,3000,5000,10000,20000,50000,100000];
  const next=milestones.find(x=>cashNum<x)||100000;
  const prev=[...milestones].reverse().find(x=>x<=cashNum)||0;
  const pct=Math.max(0,Math.min(100,(cashNum-prev)/(next-prev||1)*100));
  q("gamingWealthBar").style.width=pct+"%";
  q("gamingWealthSub").textContent=`Next milestone: ${neoMoney(next)}`;
}

(function(){
  const close=document.getElementById("neoLevelClose");
  if(close) close.onclick=()=>document.getElementById("neoLevelModal")?.classList.add("hidden");
})();

/* Wrap existing renderAll so hybrid metrics refresh with every UI render. */
const __neoOriginalRenderAll = renderAll;
renderAll = function(...args){
  const result = __neoOriginalRenderAll(...args);
  try{ renderGamingLayer(); }catch(e){ console.warn("gaming layer",e); }
  return result;
};
try{ renderGamingLayer(); }catch(e){}
