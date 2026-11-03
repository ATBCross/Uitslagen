// ATB Cross Uitslagen (app.js) - leest data/*.json, geplaatst door het programma ATB Timing
const KLASSEN = ['A', 'A40+', 'B', 'B50+', 'C', 'D', 'E'];
const MAAND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const app = document.getElementById('app');
const VERVERS_MS = 60000;

// ---------- hulpjes
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sleutel = s => norm(s).split(' ').sort().join(' ');
const slug = s => sleutel(s).replace(/ /g, '-');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const datum = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} ${MAAND[+m - 1]} ${y}`; };
const uur = t => { try { const d = new Date(t); return isNaN(d) ? '' : d.toTimeString().slice(0, 5); } catch (e) { return ''; } };
const rnr = r => 'R' + String(r).padStart(2, '0');
const plate = (bib, dag) => `<span class="plate${dag ? ' dag' : ''}" title="${dag ? 'Reservestuurbord (dagrenner)' : 'Stuurbord'}">${bib}</span>`;
const plaats = pl => pl ? pl : '–';
const klOrde = k => { const i = KLASSEN.indexOf(k); return i < 0 ? 99 : i; };

async function haal(pad) {
  const r = await fetch(pad + (pad.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(pad + ': ' + r.status);
  return r.json();
}

// ---------- gegevens
let HUIDIG = new Date().getFullYear(), DATA = null, KLAS = {}, rijen = [], renners = new Map(), perSlug = new Map(), seizoenen = [];
function verwerk(index, seizoensData, klassementen) {
  HUIDIG = index.huidig;
  const races = [], rows = [];
  for (const sd of seizoensData) {
    if (!sd) continue;
    for (const w of sd.wedstrijden || []) {
      const st = Object.values(w.klassen || {}).map(k => k.status);
      const race = { s: sd.seizoen, r: w.r, d: w.d, n: w.n, u: !w.alleenInschrijving, c: (w.rijen || []).length, klassen: w.klassen || {},
        voorlopig: st.includes('voorlopig'), bijgewerkt: Object.values(w.klassen || {}).map(k => k.tijd).filter(Boolean).sort().pop() };
      races.push(race);
      for (const x of w.rijen || []) rows.push([races.length - 1, ...x]);
    }
  }
  DATA = { races, rows };
  KLAS = klassementen;
  rijen = rows.map(([w, bib, naam, kl, club, cat, pl, ro, tijd, rt]) => {
    const race = races[w];
    return { race, w, bib, naam, kl, club, cat, pl, ro, tijd, rt: Array.isArray(rt) ? rt : [], dag: cat === 'DAG', key: sleutel(naam), s: race.s, voorlopig: (race.klassen[kl] || {}).status === 'voorlopig' };
  });
  renners = new Map();
  for (const r of rijen) {
    if (!renners.has(r.key)) renners.set(r.key, { key: r.key, namen: new Map(), clubs: new Map(), rijen: [] });
    const p = renners.get(r.key);
    p.rijen.push(r);
    p.namen.set(r.naam, (p.namen.get(r.naam) || 0) + 1);
    if (r.club) p.clubs.set(r.club, (p.clubs.get(r.club) || 0) + 1);
  }
  const meest = m => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  for (const p of renners.values()) { p.naam = meest(p.namen); p.club = meest(p.clubs); p.slug = slug(p.naam); }
  perSlug = new Map([...renners.values()].map(p => [p.slug, p]));
  seizoenen = [...new Set([HUIDIG, ...index.seizoenen, ...races.map(r => r.s)])].sort((a, b) => b - a);
}
// Formaat 2 (vanaf ATB Timing 3.60): uitslagen_<s>.json is een overzicht, elke wedstrijd staat in een eigen bestand.
// Formaat 1 (oudere seizoenen): alle wedstrijden met hun rijen in uitslagen_<s>.json.
// Bij vernieuwen worden alleen de wedstrijden opnieuw opgehaald die veranderd zijn (stempel = klassen + aantal).
let INDEX = null;
const SD = {}, KL = {};
async function laadSeizoen(s) {
  const ov = await haal(`data/uitslagen_${s}.json`);
  if (!(ov.formaat >= 2)) return ov;
  const vorig = new Map(((SD[s] && SD[s].wedstrijden) || []).map(w => [w.r, w]));
  const ws = await Promise.all((ov.wedstrijden || []).map(async o => {
    const stempel = JSON.stringify(o.klassen || {}) + '|' + (o.c ?? '');
    const oud = vorig.get(o.r);
    if (oud && oud._stempel === stempel) return oud;
    const w = await haal('data/' + o.bestand);
    w._stempel = stempel;
    return w;
  }));
  return { seizoen: ov.seizoen, wedstrijden: ws };
}
async function laadSeizoenen(lijst) {
  await Promise.all(lijst.map(async s => {
    try { SD[s] = await laadSeizoen(s); } catch (e) { if (!(s in SD)) SD[s] = null; }
    try { KL[s] = await haal(`data/klassementen_${s}.json`); } catch (e) {}
  }));
}
function herbereken() { verwerk(INDEX, INDEX.seizoenen.filter(s => SD[s]).map(s => SD[s]), KL); }
async function laadAlles(alleenHuidig) {
  INDEX = await haal('data/index.json');
  const huidig = INDEX.huidig;
  if (alleenHuidig) await laadSeizoenen([huidig]);
  else await laadSeizoenen(INDEX.seizoenen);
  herbereken();
}

// ---------- toestand
let st = { tab: 'renners', seizoen: null, zoek: '', renner: null, wedstrijd: null, klasse: null, stand: 'kampioenschap', standKlasse: null };

// ---------- kop: seizoenen en tabs
function tekenKop() {
  document.getElementById('seizoenen').innerHTML = seizoenen.map(s =>
    `<button type="button" aria-pressed="${s === st.seizoen}" data-s="${s}">${s}${s === HUIDIG ? ' · nu' : ''}</button>`).join('');
  const tabs = [['renners', 'Renners'], ['wedstrijden', 'Wedstrijden'], ['klassementen', 'Klassementen']];
  document.getElementById('tabs').innerHTML = tabs.map(([k, t]) =>
    `<button type="button" role="tab" aria-selected="${k === st.tab}" data-tab="${k}">${t}</button>`).join('');
  const live = DATA.races.find(r => r.s === HUIDIG && r.voorlopig);
  document.getElementById('live').innerHTML = live ? `<div class="wrap"><span class="puls" aria-hidden="true"></span>
    <b>${esc(live.n)}</b>&nbsp;· uitslagen komen per reeks binnen (voorlopig) · laatst om ${uur(live.bijgewerkt)}
    <button type="button" data-live="${DATA.races.indexOf(live)}">Bekijk</button></div>` : '';
}
document.getElementById('seizoenen').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  st.seizoen = +b.dataset.s; st.wedstrijd = null; st.klasse = null; st.standKlasse = null;
  try { localStorage.setItem('atb-seizoen', st.seizoen); } catch (e) {}
  teken();
});
document.getElementById('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  st.tab = b.dataset.tab; st.renner = null; if (st.tab !== 'wedstrijden') st.wedstrijd = null;
  zetHash(st.tab); teken();
});
document.getElementById('live').addEventListener('click', e => {
  const b = e.target.closest('[data-live]'); if (!b) return;
  st.tab = 'wedstrijden'; st.wedstrijd = +b.dataset.live; st.seizoen = DATA.races[st.wedstrijd].s; st.klasse = null; zetHash('wedstrijden'); teken();
});
function zetHash(h) { try { history.replaceState(null, '', '#' + h); } catch (e) {} }

// ---------- renners
function tekenRenners() {
  if (st.renner) return tekenProfiel(perSlug.get(st.renner));
  const q = norm(st.zoek);
  let html = `<div><h1>Renner opzoeken</h1><p class="sub">Typ een naam. De volgorde van voor- en achternaam maakt niet uit.</p></div>
    <div class="zoek"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="zoekveld" type="search" autocomplete="off" placeholder="bv. Klazen Bart" value="${esc(st.zoek)}" aria-label="Naam van de renner"></div>`;
  if (q.length >= 2) {
    const woorden = q.split(' ').filter(w => w.length >= 2);
    const hits = [...renners.values()].filter(p => woorden.every(w => (' ' + p.key + ' ').includes(w) || norm(p.naam).includes(w)))
      .sort((a, b) => b.rijen.length - a.rijen.length).slice(0, 40);
    html += hits.length ? `<div class="lijst" id="hits">${hits.map(p => {
      const dag = p.rijen.filter(r => r.dag).length;
      const kl = [...new Set(p.rijen.map(r => r.kl).filter(Boolean))].sort((a, b) => klOrde(a) - klOrde(b)).join(' · ');
      return `<button class="item" type="button" data-r="${p.slug}">${plate(p.rijen[0].bib, p.rijen[0].dag)}
        <span class="naam">${esc(p.naam)}<br><span class="meta">${esc(p.club || 'geen club')} · ${esc(kl)}</span></span>
        <span class="rechts">${p.rijen.length} wedstr.${dag ? `<br><span class="chip dag">${dag}× dag</span>` : ''}</span></button>`;
    }).join('')}</div>` : `<div class="leeg"><h3>Niemand gevonden</h3>Geen renner met “${esc(st.zoek)}”. Nooit eerder gereden, of anders geschreven? Probeer een deel van de naam.</div>`;
  } else {
    html += tekenPodiums();
  }
  app.innerHTML = html;
  const z = document.getElementById('zoekveld');
  z.addEventListener('input', () => { st.zoek = z.value; const pos = z.selectionStart; tekenRenners(); const n = document.getElementById('zoekveld'); n.focus(); n.setSelectionRange(pos, pos); });
}
function tekenPodiums() {
  const races = DATA.races.filter(r => r.s === st.seizoen && r.u);
  if (!races.length) return `<div class="leeg"><h3>Seizoen ${st.seizoen}: nog geen uitslagen</h3>Na elke reeks verschijnt hier het podium per klasse. Zoek intussen een renner: je ziet ook zijn uitslagen van vorige seizoenen.</div>`;
  const laatste = races[races.length - 1], w = DATA.races.indexOf(laatste);
  const perKl = groepeer(rijen.filter(r => r.w === w));
  return `<div><div class="eyebrow">${laatste.voorlopig ? 'Nu bezig' : 'Laatste wedstrijd'} · ${rnr(laatste.r)} · ${datum(laatste.d)}</div><h2>${esc(laatste.n)}</h2></div>
    <div class="podiums">${perKl.map(([kl, rs]) => `<div class="podium"><h3>${esc(kl)} <span class="eyebrow">${rs.length} renners${(laatste.klassen[kl] || {}).status === 'voorlopig' ? ' · <span class="chip voorlopig">voorlopig</span>' : ''}</span></h3><ol>${
      rs.filter(r => r.pl).slice(0, 3).map(r => `<li><b>${r.pl}</b><button type="button" data-r="${slug(r.naam)}">${esc(r.naam)}</button>${r.dag ? '<span class="chip dag">dag</span>' : `<span class="meta">${esc(r.tijd)}</span>`}</li>`).join('')}</ol></div>`).join('')}</div>`;
}
function groepeer(rs) {
  const m = new Map();
  for (const r of rs) { if (!m.has(r.kl)) m.set(r.kl, []); m.get(r.kl).push(r); }
  for (const v of m.values()) v.sort((a, b) => (a.pl || 999) - (b.pl || 999) || a.naam.localeCompare(b.naam));
  return [...m.entries()].sort((a, b) => klOrde(a[0]) - klOrde(b[0]));
}
function tekenProfiel(p) {
  if (!p) { st.renner = null; return tekenRenners(); }
  const kl = [...new Set(p.rijen.map(r => r.kl).filter(Boolean))].sort((a, b) => klOrde(a) - klOrde(b));
  const blokken = seizoenen.map(s => {
    const rs = p.rijen.filter(r => r.s === s).sort((a, b) => b.race.r - a.race.r);
    const nu = s === HUIDIG;
    const titel = `<div class="seizoenslabel"><h2>Seizoen ${s}</h2><span class="chip${nu ? ' nu' : ''}">${nu ? 'huidig seizoen' : 'vorig seizoen'}</span></div>`;
    if (!rs.length) return `<section class="seizoensblok${nu ? '' : ' vorig'}">${titel}<div class="leeg">${nu ? 'Nog geen wedstrijden gereden in ' + s + '.' : 'Niet gereden in ' + s + '.'}</div></section>`;
    const metPl = rs.filter(r => r.pl), dag = rs.filter(r => r.dag).length;
    const beste = metPl.length ? Math.min(...metPl.map(r => r.pl)) : '–';
    const top3 = metPl.filter(r => r.pl <= 3).length;
    const stand = standVan(s, p);
    return `<section class="seizoensblok${nu ? '' : ' vorig'}">${titel}
      <div class="cijfers"><div class="cijfer"><b>${new Set(rs.map(r => r.race.r)).size}</b><span>wedstrijden</span></div>
        <div class="cijfer"><b>${beste}</b><span>beste plaats</span></div>
        <div class="cijfer"><b>${stand ? (stand.kampRang || '–') : top3}</b><span>${stand ? 'kampioenschap ' + esc(stand.kl) : 'keer podium'}</span></div>
        <div class="cijfer${dag ? ' dag' : ''}"><b>${dag}</b><span>als dagrenner</span></div></div>
      <div class="tabel-wrap"><table><thead><tr><th>Pl.</th><th>Wedstrijd</th><th>Klasse</th><th>Nr.</th><th class="r">Rondes</th><th class="r">Tijd</th><th></th></tr></thead><tbody>${
        rs.map(r => `<tr class="${r.dag ? 'dagrij' : ''}"><td class="pl ${r.pl && r.pl <= 3 ? 'p' + r.pl : ''}">${plaats(r.pl)}</td>
          <td><button type="button" class="link" data-w="${r.w}">${rnr(r.race.r)} ${esc(r.race.n)}</button><br><span class="meta">${datum(r.race.d)}</span></td>
          <td><span class="chip kl">${esc(r.kl)}</span>${r.voorlopig ? ' <span class="chip voorlopig">voorlopig</span>' : ''}</td><td>${plate(r.bib, r.dag)}</td>
          <td class="r">${r.ro || '–'}</td><td class="r">${esc(r.tijd) || (r.race.u ? '–' : 'inschrijving')}</td>
          <td>${r.dag ? '<span class="chip dag">dagrenner</span>' : esc(r.cat)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }).join('');
  app.innerHTML = `<button class="terug" type="button" id="terug">← Terug naar zoeken</button>
    <div class="profiel fade"><div class="profiel-kop">${plate(p.rijen[0].bib, p.rijen[0].dag)}
      <div class="info"><h1>${esc(p.naam)}</h1><p class="sub">${esc(p.club || 'geen club')} · klasse ${esc(kl.join(' · ') || '–')}</p></div></div>${blokken}</div>`;
  document.getElementById('terug').addEventListener('click', () => { st.renner = null; zetHash('renners'); teken(); });
}
function standVan(s, p) {
  const k = KLAS[s]; if (!k) return null;
  return k.renners.find(x => sleutel(x.naam) === p.key) || null;
}

// ---------- wedstrijden
function tekenWedstrijden() {
  const races = DATA.races.map((r, i) => ({ ...r, i })).filter(r => r.s === st.seizoen);
  if (!races.length) { app.innerHTML = `<div><h1>Wedstrijden ${st.seizoen}</h1></div><div class="leeg"><h3>Het seizoen ${st.seizoen} is nog niet begonnen</h3>Op de wedstrijddag verschijnt hier de uitslag van elke reeks zodra ze gereden is.</div>`; return; }
  if (st.wedstrijd == null || DATA.races[st.wedstrijd]?.s !== st.seizoen) st.wedstrijd = races.filter(r => r.u).slice(-1)[0]?.i ?? races[0].i;
  const w = DATA.races[st.wedstrijd];
  const groepen = groepeer(rijen.filter(r => r.w === st.wedstrijd));
  if (!st.klasse || !groepen.some(g => g[0] === st.klasse)) st.klasse = groepen[0]?.[0];
  const rs = (groepen.find(g => g[0] === st.klasse) || [null, []])[1];
  const kst = w.klassen[st.klasse] || {};
  const meta = r => r.voorlopig ? `<span class="chip voorlopig">bezig</span> ${Object.keys(r.klassen).length} kl.` : (r.u ? r.c + ' renners' : 'geen uitslag');
  app.innerHTML = `<div><h1>Wedstrijden ${st.seizoen}</h1><p class="sub">${races.length} wedstrijden. Kies een wedstrijd en een klasse.</p></div>
    <div class="wedstrijden">${races.map(r => `<button type="button" class="wedstrijd" data-w="${r.i}" aria-current="${r.i === st.wedstrijd}">
      <span class="nr">${rnr(r.r)}</span><span class="pl">${esc(r.n)}</span><span class="meta">${datum(r.d)} · ${meta(r)}</span></button>`).join('')}</div>
    <div class="fade stapel">
      <div><div class="eyebrow">${rnr(w.r)} · ${datum(w.d)}</div><h2>${esc(w.n)}${w.u ? '' : ' · inschrijvingen'}</h2>${w.u ? '' : '<p class="sub">Van deze wedstrijd is geen uitslag beschikbaar, alleen de lijst van ingeschreven renners.</p>'}</div>
      <div class="klassen" role="group" aria-label="Klasse">${groepen.map(([k, v]) => `<button type="button" data-k="${esc(k)}" aria-pressed="${k === st.klasse}">${esc(k)} <small>${v.length}</small>${(w.klassen[k] || {}).status === 'voorlopig' ? '<i class="stip" title="voorlopig"></i>' : ''}</button>`).join('')}</div>
      ${kst.status === 'voorlopig' ? `<div class="melding"><b>Voorlopige uitslag</b> (${uur(kst.tijd)}). Correcties van de wedstrijddag (nummerwissels, handmatige doorkomsten) volgen in de definitieve uitslag.</div>` : ''}
      ${tabelUitslag(rs)}</div>`;
}
const sec = t => { if (!t) return Infinity; return t.split(':').reduce((a, x) => a * 60 + (+x || 0), 0); };
function tabelUitslag(rs) {
  const nR = Math.max(0, ...rs.map(r => r.rt.length));
  if (!nR) return `<div class="tabel-wrap"><table><thead><tr><th>Pl.</th><th>Nr.</th><th>Naam</th><th>Club</th><th>Cat.</th><th class="r">Rondes</th><th class="r">Tijd</th></tr></thead><tbody>${
    rs.map(r => `<tr class="${r.dag ? 'dagrij' : ''}"><td class="pl ${r.pl && r.pl <= 3 ? 'p' + r.pl : ''}">${plaats(r.pl)}</td><td>${plate(r.bib, r.dag)}</td>
      <td class="naamcel"><button type="button" data-r="${slug(r.naam)}">${esc(r.naam)}</button></td><td class="club">${esc(r.club)}</td>
      <td>${r.dag ? '<span class="chip dag">dag</span>' : esc(r.cat)}</td><td class="r">${r.ro || '–'}</td><td class="r">${esc(r.tijd) || '–'}</td></tr>`).join('')}</tbody></table></div>`;
  // met rondetijden: club onder de naam, een kolom per ronde; snelste ronde van de klasse in het geel
  const snelst = Math.min(...rs.flatMap(r => r.rt.map(sec)));
  return `<p class="uitleg">Rondetijden per renner. <span class="snelst">Geel</span> = snelste ronde van de klasse. Schuif de tabel opzij om alle rondes te zien.</p>
    <div class="tabel-wrap"><table class="rondes"><thead><tr><th>Pl.</th><th class="nrcol">Nr.</th><th>Naam</th><th class="catcol">Cat.</th>${
    Array.from({ length: nR }, (_, i) => `<th class="r">R${i + 1}</th>`).join('')}<th class="r">Tijd</th></tr></thead><tbody>${
    rs.map(r => `<tr class="${r.dag ? 'dagrij' : ''}"><td class="pl ${r.pl && r.pl <= 3 ? 'p' + r.pl : ''}">${plaats(r.pl)}</td><td class="nrcol">${plate(r.bib, r.dag)}</td>
      <td class="naamcel"><button type="button" data-r="${slug(r.naam)}">${esc(r.naam)}</button>${r.club ? `<br><span class="meta">${esc(r.club)}</span>` : ''}</td>
      <td class="catcol">${r.dag ? '<span class="chip dag">dag</span>' : esc(r.cat)}</td>${
      Array.from({ length: nR }, (_, i) => { const t = r.rt[i] || ''; return `<td class="r ronde">${t && sec(t) === snelst ? `<span class="snelst">${esc(t)}</span>` : (esc(t) || '')}</td>`; }).join('')}
      <td class="r tijd">${esc(r.tijd) || '–'}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- klassementen
const STANDEN = [['kampioenschap', 'Kampioenschap'], ['regelmaat', 'Regelmatigheid'], ['team', 'Teamklassement']];
function tekenKlassementen() {
  const k = KLAS[st.seizoen];
  const kop = `<div><h1>Klassementen ${st.seizoen}</h1>${k ? `<p class="sub">Stand na wedstrijd ${k.naWedstrijd} (${esc(k.plaats)}) · bijgewerkt ${datum((k.bijgewerkt || '').slice(0, 10))}</p>` : ''}</div>
    <div class="soorten" role="tablist">${STANDEN.map(([s, t]) => `<button type="button" role="tab" data-stand="${s}" aria-selected="${s === st.stand}">${t}</button>`).join('')}</div>`;
  if (!k) {
    app.innerHTML = kop + `<div class="leeg"><h3>Nog geen klassementen voor ${st.seizoen}</h3>De klassementen komen hier na de verwerking van de eerste wedstrijd.</div>`;
    return;
  }
  const n = k.gereden;
  const naamW = i => (k.wedstrijden.find(x => x.r === i + 1) || {}).n || '';
  const wKop = Array.from({ length: n }, (_, i) => `<th class="r" title="${esc(naamW(i))}">${rnr(i + 1)}</th>`).join('');
  if (st.stand === 'team') {
    const t = k.team || [];
    app.innerHTML = kop + (t.length ? `<div class="uitleg">Per club per wedstrijd: beste STA, tweede STA, beste SEN en beste DAM/VET. De plaats van de club telt; het laagste totaal wint.</div>
      <div class="tabel-wrap"><table class="stand"><thead><tr><th>Pl.</th><th>Club</th>${wKop}<th class="r">Totaal</th></tr></thead><tbody>${
        t.map(x => `<tr><td class="pl ${x.rang <= 3 ? 'p' + x.rang : ''}">${x.rang}</td><td class="naamcel">${esc(x.club)}</td>${
          Array.from({ length: n }, (_, i) => `<td class="r">${x.w[i] ?? '–'}</td>`).join('')}<td class="r totaal">${x.totaal}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="leeg"><h3>Geen teamklassement</h3>Het teamklassement is nog niet gepubliceerd.</div>`);
    return;
  }
  const isKamp = st.stand === 'kampioenschap';
  const klassen = [...new Set(k.renners.map(r => r.kl))].sort((a, b) => klOrde(a) - klOrde(b));
  if (!st.standKlasse || !klassen.includes(st.standKlasse)) st.standKlasse = klassen[0];
  const tellendNu = Math.min(n, k.tellend || n);
  let rs = k.renners.filter(r => r.kl === st.standKlasse);
  const rang = r => isKamp ? r.kampRang : r.regelRang, totaal = r => isKamp ? r.kamp : r.regel;
  rs.sort((a, b) => (rang(a) || 9999) - (rang(b) || 9999) || totaal(a) - totaal(b) || a.naam.localeCompare(b.naam));
  // welke wedstrijden tellen niet mee (doorstreept)
  const telNiet = r => {
    if (isKamp && Array.isArray(r.wegK)) return new Set(r.wegK);
    if (!isKamp && Array.isArray(r.wegR)) return new Set(r.wegR);
    const w = r.w.map((v, i) => ({ v: v ?? 80, i })).sort((a, b) => b.v - a.v || b.i - a.i);
    const weg = isKamp ? Math.max(0, n - tellendNu) : (n > 1 ? 1 : 0);
    return new Set(w.slice(0, weg).map(x => x.i));
  };
  const rij = r => { const tn = telNiet(r); return `<tr class="${!isKamp || r.officieel ? '' : 'onofficieel'}"><td class="pl ${rang(r) && rang(r) <= 3 ? 'p' + rang(r) : ''}">${rang(r) || '–'}</td>
    <td class="nrcol">${plate(r.bib)}</td><td class="naamcel"><button type="button" data-r="${slug(r.naam)}">${esc(r.naam)}</button><br><span class="meta">${esc(r.club)}</span></td>${
    Array.from({ length: n }, (_, i) => { const v = r.w[i]; return `<td class="r${tn.has(i) ? ' telt-niet' : ''}${v === 50 ? ' wissel' : ''}">${v ?? '–'}</td>`; }).join('')}
    <td class="r totaal">${totaal(r)}</td></tr>`; };
  const off = isKamp ? rs.filter(r => r.officieel) : rs, nietOff = isKamp ? rs.filter(r => !r.officieel) : [];
  const uitleg = isKamp && k.uitlegKamp ? esc(k.uitlegKamp) : isKamp
    ? `Punten per wedstrijd = plaats in de klasse (max. 60, 80 zonder volle ronde of niet gestart). De beste ${tellendNu} van ${n} wedstrijden tellen; doorstreept telt niet mee. Om gerangschikt te worden moet je minstens ${k.tellend} wedstrijden starten. 50 = resultaat vóór een klassewissel.`
    : `Som van alle wedstrijden min de slechtste (doorstreept). Een gemiste wedstrijd telt als 80 punten. 50 = resultaat vóór een klassewissel.`;
  app.innerHTML = kop + `<div class="klassen" role="group" aria-label="Klasse">${klassen.map(kl => `<button type="button" data-sk="${esc(kl)}" aria-pressed="${kl === st.standKlasse}">${esc(kl)}</button>`).join('')}</div>
    <div class="uitleg">${uitleg}</div>
    <div class="tabel-wrap"><table class="stand"><thead><tr><th>Pl.</th><th class="nrcol">Nr.</th><th>Naam</th>${wKop}<th class="r">Totaal</th></tr></thead><tbody>${off.map(rij).join('')}
      ${nietOff.length ? `<tr class="scheiding"><td colspan="${n + 4}">${k.nietGerangschikt ? esc(k.nietGerangschikt) : `Nog niet genoeg wedstrijden gestart (minder dan ${k.tellend})`}</td></tr>${nietOff.map(rij).join('')}` : ''}</tbody></table></div>`;
}

// ---------- tekenen en navigatie
function teken() {
  tekenKop();
  if (st.tab === 'renners') tekenRenners();
  else if (st.tab === 'wedstrijden') tekenWedstrijden();
  else tekenKlassementen();
}
app.addEventListener('click', e => {
  const r = e.target.closest('[data-r]');
  if (r) { st.tab = 'renners'; st.renner = r.dataset.r; zetHash('r-' + r.dataset.r); teken(); window.scrollTo(0, 0); return; }
  const w = e.target.closest('[data-w]');
  if (w) { st.tab = 'wedstrijden'; st.wedstrijd = +w.dataset.w; st.seizoen = DATA.races[st.wedstrijd].s; st.klasse = null; zetHash('wedstrijden'); teken(); return; }
  const k = e.target.closest('[data-k]');
  if (k) { st.klasse = k.dataset.k; teken(); return; }
  const s = e.target.closest('[data-stand]');
  if (s) { st.stand = s.dataset.stand; teken(); return; }
  const sk = e.target.closest('[data-sk]');
  if (sk) { st.standKlasse = sk.dataset.sk; teken(); }
});

// automatisch vernieuwen terwijl een wedstrijd bezig is (zonder het zoekveld te storen)
async function ververs() {
  if (document.hidden) return;
  const bezig = DATA && DATA.races.some(r => r.s === HUIDIG && r.voorlopig);
  const vandaag = new Date().toISOString().slice(0, 10);
  if (!bezig && !(DATA && DATA.races.some(r => r.d === vandaag))) return;
  try {
    const oudeW = st.wedstrijd != null ? DATA.races[st.wedstrijd] : null;
    await laadAlles(true);
    if (oudeW) { const i = DATA.races.findIndex(r => r.s === oudeW.s && r.r === oudeW.r); st.wedstrijd = i >= 0 ? i : null; }
    if (st.tab === 'renners' && !st.renner && document.activeElement?.id === 'zoekveld') { tekenKop(); return; }
    teken();
  } catch (e) {}
}

function leesHash() {
  const h = (location.hash || '').slice(1);
  if (h.startsWith('r-') && perSlug.has(h.slice(2))) { st.tab = 'renners'; st.renner = h.slice(2); }
  else if (['renners', 'wedstrijden', 'klassementen'].includes(h)) { st.tab = h; st.renner = null; }
}
// opnieuw tekenen zonder het zoekveld te storen (cursor blijft staan)
function tekenBehoudFocus() {
  const z = document.activeElement?.id === 'zoekveld' ? document.getElementById('zoekveld') : null;
  const pos = z ? z.selectionStart : 0;
  teken();
  if (z) { const n = document.getElementById('zoekveld'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
}
// voetnoot per seizoen (alleen zolang dat seizoen online staat)
const VOETNOOT = { 2026: 'Seizoen 2026 overgenomen uit de officiële uitslagen en klassementen; Merksplas heeft geen uitslag.' };
function tekenVoetnoot() {
  const t = seizoenen.filter(s => VOETNOOT[s]).map(s => VOETNOOT[s]).join(' ');
  document.getElementById('voetnoot').textContent = t ? ' ' + t : '';
}
(async function start() {
  // eerst het lopende (en het gekozen) seizoen: de site staat er sneller; vorige seizoenen volgen op de achtergrond
  let gekozen = null;
  try { const z = localStorage.getItem('atb-seizoen'); if (z) gekozen = +z; } catch (e) {}
  try {
    INDEX = await haal('data/index.json');
    await laadSeizoenen([...new Set([INDEX.huidig, ...(INDEX.seizoenen.includes(gekozen) ? [gekozen] : [])])]);
    herbereken();
  }
  catch (e) { app.innerHTML = `<div class="leeg"><h3>De uitslagen konden niet geladen worden</h3>Controleer je internetverbinding en vernieuw de pagina.</div>`; return; }
  st.seizoen = HUIDIG;
  if (gekozen && seizoenen.includes(gekozen)) st.seizoen = gekozen;
  if (!DATA.races.some(r => r.s === st.seizoen) && !KLAS[st.seizoen]) st.seizoen = seizoenen.find(s => DATA.races.some(r => r.s === s)) || HUIDIG;
  leesHash();
  teken(); tekenVoetnoot();
  window.addEventListener('hashchange', () => { leesHash(); teken(); });
  const rest = INDEX.seizoenen.filter(s => !(s in SD));
  if (rest.length) {
    await laadSeizoenen(rest);
    herbereken();
    if (!st.renner && (location.hash || '').startsWith('#r-')) leesHash();
    tekenBehoudFocus(); tekenVoetnoot();
  }
  setInterval(ververs, VERVERS_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ververs(); });
})();


if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
