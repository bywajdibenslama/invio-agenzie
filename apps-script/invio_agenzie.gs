/**
 * INVIO AUTOMATICO CANDIDATURE ALLE AGENZIE – Wajdi Ben Slama
 * Gira nel cloud di Google (Apps Script): funziona anche a Mac spento.
 *
 * Usa la cartella Google Drive "invio-agenzie":
 *   agenzie.csv            lista agenzie e stato di ogni invio
 *   testi.json             oggetto, testo e follow-up
 *   Wajdi_Ben_Slama_CV_IT.pdf   allegato per l'Italia
 *   Wajdi_Ben_Slama_CV_EN.pdf   allegato per il Regno Unito
 *   nuove_agenzie_*.csv    nuove agenzie italiane trovate da Claude (importate e rinominate .importato)
 *   nuove_uk_*.csv         nuove agenzie del Regno Unito (importate con paese = UK)
 *
 * Ogni 5 minuti, dal lunedì al venerdì dalle 8 alle 18 (ora italiana), manda 1 email,
 * con la Gmail API (servizio avanzato): la quantità giornaliera segue CFG.rampa (150 -> 300),
 * distribuita fino alle 18, al massimo CFG.maxPerGiro email ogni 5 minuti.
 * soloUK = true: si scrive SOLO alle agenzie del Regno Unito (dalle 9 italiane, le 8 a Londra),
 * nuovi contatti e follow-up; alle agenzie italiane non parte più nulla, nemmeno il follow-up.
 * soloUK = false: metà Italia e metà Regno Unito, ogni volta il paese che oggi ne ha ricevute meno.
 * Una volta all'ora controlla le risposte e smette di scrivere a chi ha risposto.
 *
 * FUNZIONI DA ESEGUIRE A MANO (menu in alto, poi "Esegui"):
 *   prova       mostra cosa partirebbe, senza spedire
 *   testAMe     manda UNA email di prova al tuo indirizzo, con il CV
 *   installa    attiva l'invio automatico
 *   ferma       disattiva l'invio automatico
 */

const CARTELLA_ID = '1IicvBstK9V_kX2sQHu9-DBhrDG48iZ5V';
const CFG = {
  nome: 'Wajdi Ben Slama',
  fileCv: 'Wajdi_Ben_Slama_CV_IT.pdf',
  fileCvEn: 'Wajdi_Ben_Slama_CV_EN.pdf',
  // Rampa: dal giorno indicato, quante email al giorno (invio con Gmail API, limite Gmail 500).
  rampa: [['2026-11-10', 150], ['2026-11-17', 200], ['2026-11-24', 250], ['2026-12-01', 300]],
  limiteSicurezza: 450,
  maxPerGiro: 6,           // massimo email ogni 5 minuti
  oraInizio: 8,
  oraInizioUK: 9,          // ora italiana: le 8 a Londra
  soloUK: true,            // true = nuovi contatti solo nel Regno Unito
  oraFine: 18,
  giorniFollowup: 5,
};
const TZ = 'Europe/Rome';
const COLONNE = ['agenzia', 'citta', 'provincia', 'email', 'sito', 'frase',
  'stato', 'data_invio', 'message_id', 'data_followup', 'note', 'paese'];
const PAROLE_RIFIUTO = ['no grazie', 'non siamo interessati', 'non interessati',
  'non ci interessa', 'rimuovete', 'cancellate', 'non contattate', 'non contattarci', 'unsubscribe',
  'no thanks', 'no thank you', 'not interested', 'please remove', 'remove me', 'do not contact', 'stop emailing'];
const DOMINI_GENERICI = ['gmail.com', 'libero.it', 'hotmail.com', 'hotmail.it', 'outlook.com',
  'outlook.it', 'yahoo.com', 'yahoo.it', 'icloud.com', 'alice.it', 'virgilio.it', 'tiscali.it'];


// ------------------------------------------------------------ comandi

function installa() {
  ferma();
  ScriptApp.newTrigger('ciclo').timeBased().everyMinutes(5).create();
  Logger.log('Invio automatico ATTIVO: ogni 5 minuti, lun-ven, dalle ' + CFG.oraInizio + ' alle ' + CFG.oraFine + ', obiettivo di oggi ' + obiettivo(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')) + ' email.');
  prova();
}

function ferma() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Invio automatico disattivato.');
}

function prova() {
  const cartella = DriveApp.getFolderById(CARTELLA_ID);
  const righe = leggiAgenzie(cartella);
  const cv = trovaFile(cartella, CFG.fileCv);
  const testi = leggiTesti(cartella);
  Logger.log('Agenzie in lista: ' + righe.length);
  Logger.log('Da contattare Italia: ' + righe.filter(r => r.stato === 'da contattare' && paese(r) === 'IT').length);
  Logger.log('Da contattare UK: ' + righe.filter(r => r.stato === 'da contattare' && paese(r) === 'UK').length);
  Logger.log('CV italiano: ' + (cv ? 'sì' : 'NO – manca ' + CFG.fileCv));
  Logger.log('CV inglese: ' + (trovaFile(cartella, CFG.fileCvEn) ? 'sì' : 'NO – manca ' + CFG.fileCvEn));
  Logger.log('Testi inglesi: ' + (testi.corpo_en ? 'sì' : 'NO – mancano in testi.json'));
  Logger.log('Obiettivo di oggi: ' + obiettivo(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')) + ' email');
  try { Gmail.Users.getProfile('me'); Logger.log('Servizio Gmail API: attivo'); }
  catch (e) { Logger.log('Servizio Gmail API: NON attivo – aggiungilo in Servizi (+) > Gmail API'); }
  const prossime = coda(righe, new Date(), true).slice(0, 10);
  prossime.forEach(([r, fu]) => Logger.log((fu ? '[follow-up] ' : '') + r.email + ' – ' + oggetto(testi, r, fu)));
  if (prossime.length) Logger.log('\nEsempio di testo:\n\n' + corpo(testi, prossime[0][0], prossime[0][1]));
}

function testAMe() {
  const cartella = DriveApp.getFolderById(CARTELLA_ID);
  const righe = leggiAgenzie(cartella);
  const testi = leggiTesti(cartella);
  const r = righe.find(x => x.stato === 'da contattare') || righe[0];
  const io = Session.getActiveUser().getEmail();
  const cv = trovaFile(cartella, CFG.fileCv);
  GmailApp.sendEmail(io, '[PROVA] ' + oggetto(testi, r, false), corpo(testi, r, false),
    { name: CFG.nome, attachments: cv ? [cv.getBlob()] : [] });
  Logger.log('Email di prova mandata a ' + io + ' (nessuna agenzia contattata).');
}

function testGmailApi() {
  const cartella = DriveApp.getFolderById(CARTELLA_ID);
  const testi = leggiTesti(cartella);
  const r = { agenzia: 'Example Studio Ltd', paese: 'UK', frase: 'I saw that you build Shopify stores for fashion brands. (test)' };
  const io = Session.getActiveUser().getEmail();
  inviaGmailApi(io, '[PROVA Gmail API] ' + oggetto(testi, r, false), corpo(testi, r, false), (trovaFile(cartella, CFG.fileCvEn) || {getBlob: () => null}).getBlob());
  Logger.log('Email di prova mandata a ' + io + ' con Gmail API (nessuna agenzia contattata).');
}

function testAMeUK() {
  const cartella = DriveApp.getFolderById(CARTELLA_ID);
  const righe = leggiAgenzie(cartella);
  const testi = leggiTesti(cartella);
  const r = righe.find(x => x.stato === 'da contattare' && paese(x) === 'UK') ||
    { agenzia: 'Example Studio Ltd', paese: 'UK',
      frase: "I saw that you build Shopify stores for fashion brands: projects where an extra developer makes a real difference at peak times. I'd like to become your trusted external developer on an ongoing basis, white label too, for Shopify customisations and order automations. I work fully remotely, so we could start straight away." };
  const io = Session.getActiveUser().getEmail();
  const cv = trovaFile(cartella, CFG.fileCvEn);
  GmailApp.sendEmail(io, '[PROVA UK] ' + oggetto(testi, r, false), corpo(testi, r, false),
    { name: CFG.nome, attachments: cv ? [cv.getBlob()] : [] });
  Logger.log('Email di prova UK mandata a ' + io + ' (nessuna agenzia contattata).');
}


// ------------------------------------------------------------ ciclo automatico

function ciclo() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const ora = new Date();
    const giorno = Number(Utilities.formatDate(ora, TZ, 'u'));   // 1 = lunedì … 7 = domenica
    const h = Number(Utilities.formatDate(ora, TZ, 'H'));
    const minuto = Number(Utilities.formatDate(ora, TZ, 'm'));
    if (giorno > 5 || h < CFG.oraInizio || h >= CFG.oraFine) return;

    const cartella = DriveApp.getFolderById(CARTELLA_ID);
    let righe = leggiAgenzie(cartella);
    let cambiato = importaNuove(cartella, righe);
    if (minuto < 5) cambiato = controllaRisposte(righe) || cambiato;

    const oggi = Utilities.formatDate(ora, TZ, 'yyyy-MM-dd');
    const oggiTot = righe.filter(r => r.data_invio.startsWith(oggi) || r.data_followup.startsWith(oggi)).length;

    const ob = obiettivo(oggi);
    const rimaste = Math.max(0, ob - oggiTot);
    const fine = new Date(ora); fine.setHours(CFG.oraFine, 0, 0, 0);
    const giri = Math.max(1, Math.floor((fine - ora) / 300000) + 1);   // giri da 5 minuti rimasti
    const perGiro = Math.min(CFG.maxPerGiro, Math.ceil(rimaste / giri));
    const daMandare = coda(righe, ora, h >= CFG.oraInizioUK).slice(0, perGiro);
    if (daMandare.length) {
      const testi = leggiTesti(cartella);
      for (const [r, fu] of daMandare) {
        const cv = trovaFile(cartella, paese(r) === 'UK' ? CFG.fileCvEn : CFG.fileCv);
        const adesso = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
        try {
          inviaGmailApi(r.email, oggetto(testi, r, fu), corpo(testi, r, fu), (!fu && cv) ? cv.getBlob() : null);
          if (fu) { r.stato = 'follow-up inviato'; r.data_followup = adesso; }
          else { r.stato = 'inviata'; r.data_invio = adesso; }
          scriviLog(cartella, 'Spedita a ' + r.agenzia + ' (' + r.email + ')' + (paese(r) === 'UK' ? ' [UK]' : '') + (fu ? ' [follow-up]' : ''));
          cambiato = true;
        } catch (e) {
          const msg = String(e);
          if (/limit|quota|rate/i.test(msg)) {           // limite di Gmail: ci si ferma, l'agenzia resta in coda
            scriviLog(cartella, 'Gmail ha fermato gli invii per limite: riprendo più tardi. (' + msg.slice(0, 120) + ')');
            break;
          }
          r.stato = 'errore invio';
          r.note = msg.slice(0, 200);
          scriviLog(cartella, 'ERRORE con ' + r.email + ': ' + msg);
          cambiato = true;
        }
        Utilities.sleep(2000);
      }
    }
    if (cambiato) salvaAgenzie(cartella, righe);
  } finally {
    lock.releaseLock();
  }
}


// ------------------------------------------------------------ logica

function obiettivo(oggi) {
  let ob = 0;
  CFG.rampa.forEach(([d, n]) => { if (oggi >= d) ob = n; });
  return Math.min(ob, CFG.limiteSicurezza);
}

// Invio con il servizio avanzato "Gmail API" (va aggiunto in Servizi): non usa la quota di 100 di Apps Script.
function inviaGmailApi(a, oggetto, testo, allegato) {
  const conf = 'conf' + Utilities.getUuid().replace(/-/g, '');
  const io = Session.getActiveUser().getEmail();
  const enc = s => '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?=';
  let mime = 'From: ' + enc(CFG.nome) + ' <' + io + '>\r\n' +
    'To: ' + a + '\r\n' +
    'Subject: ' + enc(oggetto) + '\r\n' +
    'MIME-Version: 1.0\r\n';
  const corpoB64 = Utilities.base64Encode(testo, Utilities.Charset.UTF_8).replace(/(.{76})/g, '$1\r\n');
  if (allegato) {
    mime += 'Content-Type: multipart/mixed; boundary="' + conf + '"\r\n\r\n' +
      '--' + conf + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + corpoB64 + '\r\n' +
      '--' + conf + '\r\nContent-Type: application/pdf; name="' + allegato.getName() + '"\r\n' +
      'Content-Disposition: attachment; filename="' + allegato.getName() + '"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
      Utilities.base64Encode(allegato.getBytes()).replace(/(.{76})/g, '$1\r\n') + '\r\n--' + conf + '--';
  } else {
    mime += 'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + corpoB64;
  }
  Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(mime, Utilities.Charset.UTF_8) }, 'me');
}

function paese(r) { return String(r.paese || '').toUpperCase() === 'UK' ? 'UK' : 'IT'; }

// Coda per paese (prima i follow-up, poi i nuovi); mette davanti il paese che oggi ha ricevuto meno email.
function coda(righe, ora, ukAperto) {
  const oggi = Utilities.formatDate(ora, TZ, 'yyyy-MM-dd');
  const code = { IT: [], UK: [] };
  const fatti = { IT: 0, UK: 0 };
  righe.forEach(r => {
    if (r.data_invio.startsWith(oggi) || r.data_followup.startsWith(oggi)) fatti[paese(r)]++;
    if (r.stato === 'inviata' && r.data_invio && !r.data_followup &&
        giorniLavorativi(r.data_invio.slice(0, 10), ora) >= CFG.giorniFollowup) code[paese(r)].push([r, true]);
  });
  righe.forEach(r => {
    if (r.stato === 'da contattare' && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(r.email)) code[paese(r)].push([r, false]);
  });
  if (CFG.soloUK) {
    return ukAperto ? code.UK : [];
  }
  if (!ukAperto) return code.IT;
  return fatti.UK < fatti.IT ? code.UK.concat(code.IT) : code.IT.concat(code.UK);
}

function oggetto(testi, r, fu) {
  const en = paese(r) === 'UK';
  const base = (en ? testi.oggetto_en : testi.oggetto).replace('{agenzia}', r.agenzia);
  return fu ? 'Re: ' + base : base;
}

function corpo(testi, r, fu) {
  const en = paese(r) === 'UK';
  if (fu) return en ? testi.followup_en : testi.followup;
  return (en ? testi.corpo_en : testi.corpo).replace('{frase}', (r.frase || '').trim());
}

function controllaRisposte(righe) {
  let cambiato = false;
  righe.filter(r => r.stato === 'inviata' || r.stato === 'follow-up inviato').forEach(r => {
    const dal = r.data_invio.slice(0, 10).replace(/-/g, '/');
    const dom = dominio(r.email);
    const da = DOMINI_GENERICI.includes(dom) ? r.email : dom;
    const risposte = GmailApp.search('from:(' + da + ') after:' + dal, 0, 1);
    if (risposte.length) {
      const msgs = risposte[0].getMessages();
      const testo = msgs[msgs.length - 1].getPlainBody() || '';
      const inizio = testo.toLowerCase().slice(0, 600);
      r.stato = PAROLE_RIFIUTO.some(p => inizio.includes(p)) ? 'non contattare' : 'ha risposto';
      r.note = testo.replace(/\s+/g, ' ').slice(0, 200);
      cambiato = true;
      return;
    }
    const rimbalzi = GmailApp.search('from:mailer-daemon after:' + dal + ' "' + r.email + '"', 0, 1);
    if (rimbalzi.length) { r.stato = 'errore indirizzo'; cambiato = true; }
  });
  return cambiato;
}

function importaNuove(cartella, righe) {
  const email = new Set(righe.map(r => r.email.toLowerCase()));
  const domini = new Set(righe.filter(r => r.email.includes('@')).map(r => dominio(r.email)));
  let aggiunte = 0;
  const files = cartella.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const nome = f.getName();
    if (!/^nuove_(agenzie|uk)_.*\.csv$/.test(nome)) continue;
    const uk = /^nuove_uk_/.test(nome);
    let dati;
    try { dati = leggiCsv(f.getBlob().getDataAsString('UTF-8')); }
    catch (e) { continue; }
    dati.forEach(n => {
      const em = String(n.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(em) || email.has(em)) return;
      const dom = dominio(em);
      if (!DOMINI_GENERICI.includes(dom) && domini.has(dom)) return;
      if (!String(n.frase || '').trim()) return;
      const r = {};
      COLONNE.forEach(c => r[c] = String(n[c] || '').trim());
      Object.assign(r, { email: em, stato: 'da contattare', data_invio: '', message_id: '',
        data_followup: '', note: 'trovata in automatico', paese: uk ? 'UK' : '' });
      righe.push(r);
      email.add(em); domini.add(dom);
      aggiunte++;
    });
    f.setName(nome.replace(/\.csv$/, '.importato'));
  }
  if (aggiunte) scriviLog(cartella, 'Importate ' + aggiunte + ' nuove agenzie.');
  return aggiunte > 0;
}


// ------------------------------------------------------------ file

function trovaFile(cartella, nome) {
  const it = cartella.getFilesByName(nome);
  return it.hasNext() ? it.next() : null;
}

function leggiTesti(cartella) {
  return JSON.parse(trovaFile(cartella, 'testi.json').getBlob().getDataAsString('UTF-8'));
}

function leggiCsv(testo) {
  testo = testo.replace(/^﻿/, '');
  const tab = Utilities.parseCsv(testo);
  const intest = tab.shift().map(h => h.trim());
  return tab.filter(riga => riga.some(v => v !== '')).map(riga => {
    const o = {};
    intest.forEach((h, i) => o[h] = riga[i] !== undefined ? riga[i] : '');
    return o;
  });
}

function leggiAgenzie(cartella) {
  const righe = leggiCsv(trovaFile(cartella, 'agenzie.csv').getBlob().getDataAsString('UTF-8'));
  righe.forEach(r => COLONNE.forEach(c => { if (r[c] === undefined) r[c] = ''; }));
  return righe;
}

function salvaAgenzie(cartella, righe) {
  const q = v => { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const testo = [COLONNE.join(',')].concat(righe.map(r => COLONNE.map(c => q(r[c])).join(','))).join('\n') + '\n';
  trovaFile(cartella, 'agenzie.csv').setContent(testo);
}

function scriviLog(cartella, msg) {
  const riga = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + '  ' + msg + '\n';
  const f = trovaFile(cartella, 'registro_cloud.log');
  if (f) f.setContent(f.getBlob().getDataAsString('UTF-8') + riga);
  else cartella.createFile('registro_cloud.log', riga, MimeType.PLAIN_TEXT);
}


// ------------------------------------------------------------ utilità

function dominio(email) { return String(email).split('@').pop().toLowerCase().trim(); }

function entroMinuti(testo, ora, minuti) {
  if (!testo || testo.length < 16) return false;
  const d = Utilities.parseDate(testo, TZ, 'yyyy-MM-dd HH:mm');
  return (ora - d) / 60000 < minuti;
}

function giorniLavorativi(dataIso, ora) {
  const a = Utilities.formatDate(ora, TZ, 'yyyy-MM-dd');
  let d = new Date(dataIso + 'T12:00:00Z');
  const fine = new Date(a + 'T12:00:00Z');
  let n = 0;
  while (d < fine) {
    d = new Date(d.getTime() + 86400000);
    const g = d.getUTCDay();
    if (g !== 0 && g !== 6) n++;
  }
  return n;
}
