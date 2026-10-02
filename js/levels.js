export const LEVELS = [
  { level:1, min:0,    next:100,  title:"Stabilizacja",             finance:"0–500 zł" },
  { level:2, min:100,  next:240,  title:"Pierwszy bufor",           finance:"500–1 000 zł" },
  { level:3, min:240,  next:420,  title:"Oddech operacyjny",        finance:"1 000–3 000 zł" },
  { level:4, min:420,  next:650,  title:"Poduszka startowa",        finance:"3 000–5 000 zł" },
  { level:5, min:650,  next:950,  title:"Swoboda operacyjna",       finance:"5 000–10 000 zł" },
  { level:6, min:950,  next:1350, title:"BFI 10K+",                 finance:"10 000–20 000 zł" },
  { level:7, min:1350, next:1850, title:"Kapitał rośnie",           finance:"20 000–50 000 zł" },
  { level:8, min:1850, next:2500, title:"Solidna baza",             finance:"50 000–100 000 zł" },
  { level:9, min:2500, next:3300, title:"Rosnąca niezależność",     finance:"100 000–250 000 zł" },
  { level:10,min:3300, next:4300, title:"Kapitał strategiczny",     finance:"250 000–500 000 zł" },
  { level:11,min:4300, next:5600, title:"Pół miliona+",             finance:"500 000–1 000 000 zł" },
  { level:12,min:5600, next:null, title:"Milionowy poziom",         finance:"1 000 000 zł+" }
];

export function getLevelInfo(xp = 0) {
  let current = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.min) current = l;
  const max = current.next ?? current.min + 1000;
  const span = Math.max(1, max - current.min);
  const progress = current.next ? Math.max(0, Math.min(100, ((xp-current.min)/span)*100)) : 100;
  return { ...current, progress, currentXp: xp-current.min, needed: current.next ? span : span };
}

export function xpForTask(task) {
  const base = task.priority === "P1" ? 35 : task.priority === "P2" ? 20 : 10;
  const moneyBonus = task.category === "money" ? 10 : 0;
  return base + moneyBonus;
}
