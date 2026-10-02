import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ALLOW_SIGNUP } from "./config.js";
import { defaults } from "./state.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

export async function getSession() {
  return (await supabase.auth.getSession()).data.session;
}
export async function sendMagicLink(email) {
  return supabase.auth.signInWithOtp({
    email,
    options:{
      shouldCreateUser:ALLOW_SIGNUP,
      emailRedirectTo:window.location.origin + window.location.pathname
    }
  });
}
export async function signInPassword(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}
export async function setPassword(password) {
  return supabase.auth.updateUser({
    password,
    data: { password_set: true }
  });
}
export async function signOut() {
  return supabase.auth.signOut();
}
export async function sendPasswordReset(email) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
}
export function onAuth(cb) { return supabase.auth.onAuthStateChange((event,session)=>cb(event,session)); }
export async function deleteTaskRow(id) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}


export async function deleteDailyLogRow(id) {
  const { error } = await supabase.from("daily_logs").delete().eq("id", id);
  if (error) throw error;
}


export async function cloudHasData(uid) {
  const {data,error}=await supabase.from("user_stats").select("user_id").eq("user_id",uid).maybeSingle();
  if(error) throw error;
  return !!data;
}

export async function hydrateCloud(uid) {
  const reqs = await Promise.all([
    supabase.from("user_stats").select("*").eq("user_id",uid).maybeSingle(),
    supabase.from("days").select("*").eq("user_id",uid),
    supabase.from("tasks").select("*").eq("user_id",uid),
    supabase.from("projects").select("*").eq("user_id",uid),
    supabase.from("ideas").select("*").eq("user_id",uid),
    supabase.from("proof").select("*").eq("user_id",uid).order("created_at",{ascending:false}),
    supabase.from("reviews").select("*").eq("user_id",uid).order("created_at",{ascending:false}),
    supabase.from("finance_snapshots").select("*").eq("user_id",uid),
    supabase.from("body_logs").select("*").eq("user_id",uid),
    supabase.from("daily_logs").select("*").eq("user_id",uid).order("created_at",{ascending:false})
  ]);
  const bad=reqs.find(r=>r.error); if(bad) throw bad.error;
  const [stats,days,tasks,projects,ideas,proof,reviews,finance,body,dailyLogs]=reqs;

  // Meal Planner is an add-on. If its migration has not been run yet,
  // the rest of Personal OS must still load normally.
  const [mealPlansRaw, mealRecipesRaw] = await Promise.all([
    supabase.from("meal_plans").select("*").eq("user_id",uid),
    supabase.from("meal_recipes").select("*").eq("user_id",uid)
  ]);
  const mealPlans = mealPlansRaw.error ? {data:[]} : mealPlansRaw;
  const mealRecipes = mealRecipesRaw.error ? {data:[]} : mealRecipesRaw;
  const state=defaults();
  if(stats.data){state.xp=stats.data.xp||0;state.streak=stats.data.streak||0;state.lastReviewDate=stats.data.last_review_date||null}
  for(const r of days.data||[]) state.days[r.day]={
    interviewCompleted:!!r.interview_completed,
    interview:{feeling:r.feeling||"",energy:r.energy??5,sleepHours:Number(r.sleep_hours??7),sleepQuality:r.sleep_quality??5,overload:r.overload??5,availableHours:Number(r.available_hours??4)},
    capacity:{score:Number(r.capacity_score??0),percent:r.capacity_percent??0,mode:r.day_mode||"standard",label:r.day_label||"",copy:r.day_copy||"",updatedAt:r.capacity_updated_at||null},
    currentEnergy:r.current_energy??null,
    top3:[r.top1||"",r.top2||"",r.top3||""],moneyMove:r.money_move||"",
    minimums:{eat:!!r.ate,water:!!r.drank_water,movement:!!r.moved,moneyAction:!!r.money_action}
  };
  state.tasks=(tasks.data||[]).map(r=>({
    id:r.id,title:r.title,category:r.category,priority:r.priority,
    estimateMinutes:r.estimate_minutes,actualMinutes:r.actual_minutes,
    scheduledAt:r.scheduled_at,scheduledMinutes:r.scheduled_minutes,
    completedAt:r.completed_at,status:r.status,createdAt:r.created_at,
    notes:r.notes||"",dueDate:r.due_date||null,linkUrl:r.link_url||"",
    checklist:Array.isArray(r.checklist)?r.checklist:[]
  }));
  for(const r of projects.data||[]) state.projects[r.id]={label:r.label,status:r.status,nextAction:r.next_action||""};
  state.ideas=(ideas.data||[]).map(r=>({id:r.id,title:r.title,category:r.category,status:r.status,createdAt:r.created_at}));
  state.proof=(proof.data||[]).map(r=>({id:r.id,date:r.day,text:r.text,source:r.source,createdAt:r.created_at}));
  state.reviews=(reviews.data||[]).map(r=>({id:r.id,date:r.day,done:r.done,learn:r.learn,tomorrow:r.tomorrow,createdAt:r.created_at}));
  for(const r of finance.data||[]) state.financeSnapshots[r.day]={cash:r.cash||"0 zł",protected:r.protected||"0 zł",incoming:r.incoming||"0 zł",bills:r.bills||"0 zł",revenueToday:r.revenue_today||"0 zł",revenueMonth:r.revenue_month||"0 zł"};
  for(const r of body.data||[]) state.bodyLogs[r.day]={steps:r.steps??"",weight:r.weight??"",water:r.water??"",sleep:r.sleep??"",workout:!!r.workout};
  state.dailyLogs=(dailyLogs.data||[]).map(r=>({
    id:r.id,date:r.day,section:r.section,title:r.title,note:r.note||"",payload:r.payload||{},createdAt:r.created_at
  }));
  state.mealPlans=(mealPlans.data||[]).map(r=>({id:r.id,taskId:r.task_id,name:r.name,mealType:r.meal_type,date:r.meal_date,time:String(r.meal_time||"").slice(0,5),ingredients:r.ingredients||"",recipe:r.recipe||"",calories:r.calories,protein:r.protein,preparedAt:r.prepared_at,eatenAt:r.eaten_at,xpAwarded:!!r.xp_awarded,createdAt:r.created_at}));
  state.mealRecipes=(mealRecipes.data||[]).map(r=>({id:r.id,name:r.name,mealType:r.meal_type,ingredients:r.ingredients||"",recipe:r.recipe||"",calories:r.calories,protein:r.protein,createdAt:r.created_at}));
  return state;
}


const lastFingerprints = {};
function fp(value) {
  return JSON.stringify(value);
}
export function seedSyncFingerprints(state) {
  lastFingerprints.stats = fp([state.xp||0,state.streak||0,state.lastReviewDate||null]);
  lastFingerprints.days = fp(state.days||{});
  lastFingerprints.tasks = fp(state.tasks||[]);
  lastFingerprints.projects = fp(state.projects||{});
  lastFingerprints.ideas = fp(state.ideas||[]);
  lastFingerprints.proof = fp(state.proof||[]);
  lastFingerprints.reviews = fp(state.reviews||[]);
  lastFingerprints.finance = fp(state.financeSnapshots||{});
  lastFingerprints.body = fp(state.bodyLogs||{});
  lastFingerprints.logs = fp(state.dailyLogs||[]);
  lastFingerprints.meals = fp(state.mealPlans||[]);
  lastFingerprints.recipes = fp(state.mealRecipes||[]);
}

export async function syncCloud(uid,state,{force=false}={}) {
  const now=new Date().toISOString();
  const errors=[];
  const grab=async(p)=>{const r=await p;if(r.error)errors.push(r.error);return r};
  const changed=(key,value)=>{
    const next=fp(value);
    if(force || lastFingerprints[key]!==next){
      lastFingerprints[key]=next;
      return true;
    }
    return false;
  };

  if(changed("stats",[state.xp||0,state.streak||0,state.lastReviewDate||null])){
    await grab(supabase.from("user_stats").upsert({
      user_id:uid,xp:state.xp||0,streak:state.streak||0,
      last_review_date:state.lastReviewDate||null,updated_at:now
    },{onConflict:"user_id"}));
  }

  if(changed("days",state.days||{})){
    const dayRows=Object.entries(state.days||{}).map(([day,d])=>({
      user_id:uid,day,interview_completed:!!d.interviewCompleted,feeling:d.interview?.feeling||"",energy:d.interview?.energy??5,
      sleep_hours:d.interview?.sleepHours??7,sleep_quality:d.interview?.sleepQuality??5,overload:d.interview?.overload??5,available_hours:d.interview?.availableHours??4,
      capacity_score:d.capacity?.score??0,capacity_percent:d.capacity?.percent??0,day_mode:d.capacity?.mode||"standard",day_label:d.capacity?.label||"",day_copy:d.capacity?.copy||"",
      current_energy:d.currentEnergy??null,capacity_updated_at:d.capacity?.updatedAt||null,
      top1:d.top3?.[0]||"",top2:d.top3?.[1]||"",top3:d.top3?.[2]||"",money_move:d.moneyMove||"",
      ate:!!d.minimums?.eat,drank_water:!!d.minimums?.water,moved:!!d.minimums?.movement,money_action:!!d.minimums?.moneyAction,updated_at:now
    }));
    if(dayRows.length) await grab(supabase.from("days").upsert(dayRows,{onConflict:"user_id,day"}));
  }

  if(changed("tasks",state.tasks||[]) && state.tasks.length){
    await grab(supabase.from("tasks").upsert(state.tasks.map(t=>({
      id:t.id,user_id:uid,title:t.title,category:t.category,priority:t.priority,
      estimate_minutes:t.estimateMinutes ?? null,actual_minutes:t.actualMinutes ?? null,
      scheduled_at:t.scheduledAt||null,scheduled_minutes:t.scheduledMinutes ?? null,completed_at:t.completedAt||null,status:t.status,
      notes:t.notes||null,due_date:t.dueDate||null,link_url:t.linkUrl||null,
      checklist:Array.isArray(t.checklist)?t.checklist:[],
      created_at:t.createdAt||now,updated_at:now
    })),{onConflict:"id"}));
  }

  if(changed("projects",state.projects||{})){
    const projectRows=Object.entries(state.projects||{}).map(([id,p])=>({
      id,user_id:uid,label:p.label,status:p.status,next_action:p.nextAction||"",updated_at:now
    }));
    if(projectRows.length) await grab(supabase.from("projects").upsert(projectRows,{onConflict:"user_id,id"}));
  }

  if(changed("ideas",state.ideas||[]) && state.ideas.length)
    await grab(supabase.from("ideas").upsert(state.ideas.map(x=>({
      id:x.id,user_id:uid,title:x.title,category:x.category,status:x.status,
      created_at:x.createdAt||now,updated_at:now
    })),{onConflict:"id"}));

  if(changed("proof",state.proof||[]) && state.proof.length)
    await grab(supabase.from("proof").upsert(state.proof.map(x=>({
      id:x.id,user_id:uid,day:x.date,text:x.text,source:x.source||null,created_at:x.createdAt||now
    })),{onConflict:"id"}));

  if(changed("reviews",state.reviews||[]) && state.reviews.length)
    await grab(supabase.from("reviews").upsert(state.reviews.map(x=>({
      id:x.id,user_id:uid,day:x.date,done:x.done||"",learn:x.learn||"",tomorrow:x.tomorrow||"",
      created_at:x.createdAt||now
    })),{onConflict:"id"}));

  if(changed("finance",state.financeSnapshots||{})){
    const financeRows=Object.entries(state.financeSnapshots||{}).map(([day,f])=>({
      user_id:uid,day,cash:f.cash||"",protected:f.protected||"",incoming:f.incoming||"",
      bills:f.bills||"",revenue_today:f.revenueToday||"",revenue_month:f.revenueMonth||"",updated_at:now
    }));
    if(financeRows.length) await grab(supabase.from("finance_snapshots").upsert(financeRows,{onConflict:"user_id,day"}));
  }

  if(changed("body",state.bodyLogs||{})){
    const bodyRows=Object.entries(state.bodyLogs||{}).map(([day,b])=>({
      user_id:uid,day,
      steps:b.steps===""?null:Number(b.steps),
      weight:b.weight===""?null:Number(b.weight),
      water:b.water===""?null:Number(b.water),
      sleep:b.sleep===""?null:Number(b.sleep),
      workout:!!b.workout,updated_at:now
    }));
    if(bodyRows.length) await grab(supabase.from("body_logs").upsert(bodyRows,{onConflict:"user_id,day"}));
  }

  if(changed("logs",state.dailyLogs||[]) && state.dailyLogs.length){
    await grab(supabase.from("daily_logs").upsert(state.dailyLogs.map(x=>({
      id:x.id,user_id:uid,day:x.date,section:x.section,title:x.title,
      note:x.note||null,payload:x.payload||{},created_at:x.createdAt||now
    })),{onConflict:"id"}));
  }

  if(changed("meals",state.mealPlans||[]) && state.mealPlans.length){
    await grab(supabase.from("meal_plans").upsert(state.mealPlans.map(m=>({id:m.id,user_id:uid,task_id:m.taskId||null,name:m.name,meal_type:m.mealType||"Posiłek",meal_date:m.date,meal_time:m.time,ingredients:m.ingredients||null,recipe:m.recipe||null,calories:m.calories??null,protein:m.protein??null,prepared_at:m.preparedAt||null,eaten_at:m.eatenAt||null,xp_awarded:!!m.xpAwarded,created_at:m.createdAt||now,updated_at:now})),{onConflict:"id"}));
  }
  if(changed("recipes",state.mealRecipes||[]) && state.mealRecipes.length){
    await grab(supabase.from("meal_recipes").upsert(state.mealRecipes.map(r=>({id:r.id,user_id:uid,name:r.name,meal_type:r.mealType||"Posiłek",ingredients:r.ingredients||null,recipe:r.recipe||null,calories:r.calories??null,protein:r.protein??null,created_at:r.createdAt||now,updated_at:now})),{onConflict:"id"}));
  }

  if(errors.length) throw errors[0];
}

export async function deleteMealPlanRow(id) { const { error } = await supabase.from("meal_plans").delete().eq("id", id); if(error) throw error; }
