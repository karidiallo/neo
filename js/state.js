export const categories = [
  {id:"personal",label:"Personal OS / mój progress",desc:"ogólny rozwój, organizacja systemu, dashboard, rzeczy przekrojowe"},
  {id:"general",label:"Ogólne / kilka obszarów",desc:"zadanie dotyczy kilku części życia naraz"},
  {id:"money",label:"Ruch finansowy / BFI",desc:"sprzedaż, przychód, odzyskanie pieniędzy, płatności"},
  {id:"digitalmap",label:"DigitalMap",desc:"sprzedaż, delivery, produkt, marketing"},
  {id:"nenefl",label:"NeneFL",desc:"muzyka, marka, release, A&R, creative"},
  {id:"body",label:"Ciało / zdrowie",desc:"trening, zdrowie, jedzenie, ruch"},
  {id:"life",label:"Życie / administracja",desc:"mieszkanie, dokumenty, sprawy bieżące"},
  {id:"learning",label:"Nauka",desc:"francuski, certyfikaty, rozwój"},
  {id:"other",label:"Inne / własna kategoria",desc:"wpisujesz własną kategorię"}
];

export const STORAGE_KEY = "personalOS_repo_v1";

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
export function isoAt(day, time) {
  const [y,m,d] = day.split("-").map(Number);
  const [hh,mm] = time.split(":").map(Number);
  return new Date(y,m-1,d,hh,mm,0,0).toISOString();
}
export function localParts(iso) {
  const d = new Date(iso);
  return { date:dateKey(d), time:`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}` };
}
export function newDay() {
  return {
    interviewCompleted:false,
    interview:{feeling:"",energy:5,sleepHours:7,sleepQuality:5,overload:5,availableHours:4},
    capacity:{score:0,percent:0,mode:"standard",label:"Dzisiaj robimy dzień standardowy.",copy:"",updatedAt:null},
    currentEnergy:null,
    top3:["","",""], moneyMove:"",
    minimums:{eat:false,water:false,movement:false,moneyAction:false}
  };
}
export function defaults() {
  return {
    version:"repo-1",
    xp:0,streak:0,lastReviewDate:null,
    days:{},tasks:[],
    projects:{
      digitalmap:{label:"DigitalMap",status:"Główny",nextAction:""},
      nenefl:{label:"NeneFL",status:"Aktywny",nextAction:""},
      body:{label:"Ciało",status:"Podtrzymanie",nextAction:""},
      life:{label:"Życie / administracja",status:"Aktywny",nextAction:""},
      learning:{label:"Nauka",status:"Aktywny",nextAction:""}
    },
    ideas:[],proof:[],reviews:[],financeSnapshots:{},bodyLogs:{},dailyLogs:[]
  };
}
export function loadLocal() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)||"null") || defaults();
}
export function persistLocal(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
