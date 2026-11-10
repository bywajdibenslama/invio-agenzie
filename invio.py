"""
Invio automatico email alle agenzie (GitHub Actions + Gmail + Google Drive).

Ogni esecuzione (ogni 15 minuti, lun-ven, dalle 9 alle 18 ora italiana):
  1. legge agenzie.csv e testi.json dalla cartella Drive "invio-agenzie";
  2. importa i nuovi file nuove_uk_*.csv (e li rinomina .importato);
  3. controlla nella casella le risposte e gli indirizzi rimbalzati (IMAP);
  4. manda le email che servono per restare in pari con l'obiettivo del giorno
     (rampa: 150 -> 200 -> 250 -> 300), prima i follow-up e poi i nuovi contatti;
  5. salva agenzie.csv e aggiunge le righe al registro.

Variabili d'ambiente (GitHub Secrets):
  GMAIL_USER          es. bywajdibenslama@gmail.com
  GMAIL_APP_PASSWORD  password per app di 16 lettere
  GDRIVE_SA_JSON      chiave JSON del service account con accesso alla cartella
Opzionali: CARTELLA_ID, PROVA=1 (non spedisce e non salva nulla)
"""

import csv
import email.utils
import imaplib
import io
import json
import os
import random
import re
import smtplib
import sys
import time
from datetime import date, datetime, timedelta
from email.header import decode_header, make_header
from email.message import EmailMessage
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Rome")
CARTELLA_ID = os.environ.get("CARTELLA_ID", "1IicvBstK9V_kX2sQHu9-DBhrDG48iZ5V")
NOME = "Wajdi Ben Slama"
FILE_CSV, FILE_TESTI, FILE_LOG = "agenzie.csv", "testi.json", "registro_cloud.log"
FILE_CV_EN = "Wajdi_Ben_Slama_CV_EN.pdf"

ORA_INIZIO, ORA_FINE = 9, 18          # ora italiana (= 8-17 a Londra)
GIORNI_FOLLOWUP = 5                   # giorni lavorativi prima del follow-up
MAX_PER_GIRO = 12                     # mai più di 12 email in un'esecuzione
LIMITE_SICUREZZA = 450                # mai oltre, qualunque cosa dica la rampa
MINUTI_TRA_GIRI = 15

# Rampa: dalla data indicata, obiettivo giornaliero.
RAMPA = [
    (date(2026, 11, 10), 150),
    (date(2026, 11, 17), 200),
    (date(2026, 11, 24), 250),
    (date(2026, 12, 1), 300),
]

COLONNE = ["agenzia", "citta", "provincia", "email", "sito", "frase", "stato",
           "data_invio", "message_id", "data_followup", "note", "paese"]
PAROLE_RIFIUTO = ["no grazie", "non siamo interessati", "non interessati", "non ci interessa",
                  "rimuovete", "cancellate", "non contattate", "non contattarci", "unsubscribe",
                  "no thanks", "no thank you", "not interested", "please remove", "remove me",
                  "do not contact", "stop emailing"]
DOMINI_GENERICI = {"gmail.com", "libero.it", "hotmail.com", "hotmail.it", "outlook.com", "outlook.it",
                   "yahoo.com", "yahoo.it", "icloud.com", "alice.it", "virgilio.it", "tiscali.it",
                   "hotmail.co.uk", "outlook.co.uk", "yahoo.co.uk", "btinternet.com", "live.co.uk"}
RE_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)

PROVA = os.environ.get("PROVA") == "1"


# ----------------------------------------------------------------- utilità

def adesso():
    return datetime.now(TZ)


def dominio(em):
    return em.split("@")[-1].strip().lower()


def obiettivo(giorno):
    ob = 0
    for d, n in RAMPA:
        if giorno >= d:
            ob = n
    return min(ob, LIMITE_SICUREZZA)


def giorni_lavorativi(da, a):
    """Giorni lavorativi tra la data da (esclusa) e a (inclusa)."""
    n, d = 0, da
    while d < a:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def paese(r):
    return "UK" if (r.get("paese") or "").upper() == "UK" else "IT"


# ----------------------------------------------------------------- Google Drive

class Drive:
    def __init__(self):
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        info = json.loads(os.environ["GDRIVE_SA_JSON"])
        cred = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/drive"])
        self.s = build("drive", "v3", credentials=cred, cache_discovery=False)

    def elenco(self):
        out, tok = [], None
        while True:
            res = self.s.files().list(
                q=f"'{CARTELLA_ID}' in parents and trashed = false",
                fields="nextPageToken, files(id, name)", pageSize=1000, pageToken=tok).execute()
            out += res.get("files", [])
            tok = res.get("nextPageToken")
            if not tok:
                return out

    def trova(self, nome, files=None):
        for f in files or self.elenco():
            if f["name"] == nome:
                return f["id"]
        return None

    def leggi(self, fid):
        from googleapiclient.http import MediaIoBaseDownload
        buf = io.BytesIO()
        req = self.s.files().get_media(fileId=fid)
        dl = MediaIoBaseDownload(buf, req)
        fatto = False
        while not fatto:
            _, fatto = dl.next_chunk()
        return buf.getvalue()

    def scrivi(self, fid, dati, mime):
        from googleapiclient.http import MediaIoBaseUpload
        self.s.files().update(fileId=fid, media_body=MediaIoBaseUpload(io.BytesIO(dati), mimetype=mime)).execute()

    def rinomina(self, fid, nome):
        self.s.files().update(fileId=fid, body={"name": nome}).execute()


def leggi_csv(testo):
    testo = testo.lstrip("﻿")
    return [dict(r) for r in csv.DictReader(io.StringIO(testo))]


def csv_testo(righe):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLONNE, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    for r in righe:
        w.writerow({c: r.get(c, "") for c in COLONNE})
    return buf.getvalue()


# ----------------------------------------------------------------- import

def importa_nuove(drive, files, righe, log):
    emails = {r["email"].lower() for r in righe}
    domini = {dominio(r["email"]) for r in righe if "@" in r["email"]}
    aggiunte = 0
    for f in files:
        nome = f["name"]
        if not re.match(r"^nuove_(agenzie|uk)_.*\.csv$", nome):
            continue
        uk = nome.startswith("nuove_uk_")
        try:
            dati = leggi_csv(drive.leggi(f["id"]).decode("utf-8"))
        except Exception as e:
            log(f"File {nome} non leggibile: {e}")
            continue
        for n in dati:
            em = (n.get("email") or "").strip().lower()
            if not RE_EMAIL.match(em) or em in emails:
                continue
            dom = dominio(em)
            if dom not in DOMINI_GENERICI and dom in domini:
                continue
            if not (n.get("frase") or "").strip():
                continue
            r = {c: (n.get(c) or "").strip() for c in COLONNE}
            r.update(email=em, stato="da contattare", data_invio="", message_id="",
                     data_followup="", note="trovata in automatico", paese="UK" if uk else "")
            righe.append(r)
            emails.add(em)
            domini.add(dom)
            aggiunte += 1
        if not PROVA:
            drive.rinomina(f["id"], re.sub(r"\.csv$", ".importato", nome))
    if aggiunte:
        log(f"Importate {aggiunte} nuove agenzie.")
    return aggiunte > 0


# ----------------------------------------------------------------- risposte (IMAP)

def testo_messaggio(msg):
    if msg.is_multipart():
        for p in msg.walk():
            if p.get_content_type() == "text/plain" and not p.get_filename():
                try:
                    return p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8", "replace")
                except Exception:
                    pass
        return ""
    try:
        return msg.get_payload(decode=True).decode(msg.get_content_charset() or "utf-8", "replace")
    except Exception:
        return ""


def cartella_tutti(imap):
    typ, dati = imap.list()
    for riga in dati or []:
        s = riga.decode(errors="replace")
        if "\\All" in s:
            return s.split(' "/" ')[-1].strip()
    return "INBOX"


def controlla_risposte(righe, utente, password, log):
    import email as emaillib
    attese = [r for r in righe if r["stato"] in ("inviata", "follow-up inviato")]
    if not attese:
        return False
    per_indirizzo = {r["email"].lower(): r for r in attese}
    per_dominio = {}
    for r in attese:
        d = dominio(r["email"])
        if d not in DOMINI_GENERICI:
            per_dominio.setdefault(d, r)
    cambiato = False
    imap = imaplib.IMAP4_SSL("imap.gmail.com")
    try:
        imap.login(utente, password)
        imap.select(cartella_tutti(imap), readonly=True)
        typ, dati = imap.search(None, "X-GM-RAW", '"newer_than:2d -from:me"')
        ids = (dati[0] or b"").split()[-300:]
        for mid in ids:
            typ, parti = imap.fetch(mid, "(RFC822)")
            if not parti or not parti[0]:
                continue
            msg = emaillib.message_from_bytes(parti[0][1])
            mitt = email.utils.parseaddr(str(make_header(decode_header(msg.get("From", "")))))[1].lower()
            corpo = testo_messaggio(msg)
            if mitt.startswith(("mailer-daemon@", "postmaster@")):
                for em, r in per_indirizzo.items():
                    if em in corpo.lower() and r["stato"] != "errore indirizzo":
                        r["stato"] = "errore indirizzo"
                        log(f"Indirizzo non valido: {em}")
                        cambiato = True
                continue
            r = per_indirizzo.get(mitt) or per_dominio.get(dominio(mitt))
            if not r or r["stato"] not in ("inviata", "follow-up inviato"):
                continue
            inizio = corpo.lower()[:600]
            r["stato"] = "non contattare" if any(p in inizio for p in PAROLE_RIFIUTO) else "ha risposto"
            r["note"] = re.sub(r"\s+", " ", corpo)[:200]
            log(f"Risposta da {r['agenzia']} ({mitt}): {r['stato']}")
            cambiato = True
    finally:
        try:
            imap.logout()
        except Exception:
            pass
    return cambiato


# ----------------------------------------------------------------- invio

def coda(righe, oggi):
    """Solo Regno Unito: prima i follow-up dovuti, poi i nuovi contatti."""
    fu, nuovi = [], []
    for r in righe:
        if paese(r) != "UK":
            continue
        if r["stato"] == "inviata" and r["data_invio"] and not r["data_followup"]:
            try:
                d = date.fromisoformat(r["data_invio"][:10])
            except ValueError:
                continue
            if giorni_lavorativi(d, oggi) >= GIORNI_FOLLOWUP:
                fu.append((r, True))
        elif r["stato"] == "da contattare" and RE_EMAIL.match(r["email"]):
            nuovi.append((r, False))
    return fu + nuovi


def componi(testi, r, fu, utente, cv):
    m = EmailMessage()
    oggetto = testi["oggetto_en"].replace("{agenzia}", r["agenzia"])
    m["Subject"] = ("Re: " + oggetto) if fu else oggetto
    m["From"] = email.utils.formataddr((NOME, utente))
    m["To"] = r["email"]
    m["Date"] = email.utils.formatdate(localtime=True)
    mid = email.utils.make_msgid(domain="gmail.com")
    m["Message-ID"] = mid
    if fu and (r.get("message_id") or "").startswith("<"):
        m["In-Reply-To"] = r["message_id"]
        m["References"] = r["message_id"]
    corpo = testi["followup_en"] if fu else testi["corpo_en"].replace("{frase}", (r.get("frase") or "").strip())
    m.set_content(corpo)
    if cv and not fu:
        m.add_attachment(cv, maintype="application", subtype="pdf", filename=FILE_CV_EN)
    return m, mid


def quante_ora(righe, ora):
    oggi = ora.date().isoformat()
    fatte = sum(1 for r in righe if r["data_invio"].startswith(oggi) or r["data_followup"].startswith(oggi))
    ob = obiettivo(ora.date())
    rimaste = max(0, ob - fatte)
    fine = ora.replace(hour=ORA_FINE, minute=0, second=0, microsecond=0)
    giri = max(1, int((fine - ora).total_seconds() // (MINUTI_TRA_GIRI * 60)) + 1)
    per_giro = min(MAX_PER_GIRO, -(-rimaste // giri))   # arrotondato per eccesso
    return per_giro, fatte, ob


# ----------------------------------------------------------------- main

def main():
    ora = adesso()
    utente = os.environ["GMAIL_USER"]
    password = os.environ["GMAIL_APP_PASSWORD"].replace(" ", "")
    drive = Drive()
    files = drive.elenco()
    id_csv, id_testi, id_log = (drive.trova(n, files) for n in (FILE_CSV, FILE_TESTI, FILE_LOG))
    id_cv = drive.trova(FILE_CV_EN, files)
    if not id_csv or not id_testi:
        print("Mancano agenzie.csv o testi.json nella cartella: esco.")
        return

    righe = leggi_csv(drive.leggi(id_csv).decode("utf-8"))
    for r in righe:
        for c in COLONNE:
            r[c] = (r.get(c) or "").strip()
    testi = json.loads(drive.leggi(id_testi).decode("utf-8"))
    righe_log = []

    def log(t):
        riga = ora.strftime("%Y-%m-%d %H:%M") + "  " + t
        print(riga)
        righe_log.append(riga)

    cambiato = importa_nuove(drive, files, righe, log)
    try:
        cambiato = controlla_risposte(righe, utente, password, log) or cambiato
    except Exception as e:
        print("Controllo risposte non riuscito:", e)

    feriale = ora.weekday() < 5
    in_orario = ORA_INIZIO <= ora.hour < ORA_FINE
    per_giro, fatte, ob = quante_ora(righe, ora)
    print(f"Oggi: {fatte}/{ob} email. In questo giro: {per_giro if (feriale and in_orario) else 0}.")

    if feriale and in_orario and per_giro > 0:
        da_mandare = coda(righe, ora.date())[:per_giro]
        if da_mandare:
            cv = drive.leggi(id_cv) if id_cv else None
            if not cv:
                log(f"ATTENZIONE: manca {FILE_CV_EN}, le email partono senza CV.")
            smtp = None
            if not PROVA:
                smtp = smtplib.SMTP("smtp.gmail.com", 587, timeout=60)
                smtp.starttls()
                smtp.login(utente, password)
            try:
                for i, (r, fu) in enumerate(da_mandare):
                    msg, mid = componi(testi, r, fu, utente, cv)
                    t = adesso().strftime("%Y-%m-%d %H:%M")
                    if PROVA:
                        print(f"[PROVA] {r['email']} – {msg['Subject']}")
                        continue
                    try:
                        smtp.send_message(msg)
                        if fu:
                            r["stato"], r["data_followup"] = "follow-up inviato", t
                        else:
                            r["stato"], r["data_invio"], r["message_id"] = "inviata", t, mid
                        log(f"Spedita a {r['agenzia']} ({r['email']}) [UK]" + (" [follow-up]" if fu else ""))
                    except smtplib.SMTPRecipientsRefused as e:
                        r["stato"], r["note"] = "errore indirizzo", str(e)[:200]
                        log(f"Indirizzo rifiutato: {r['email']}")
                    except smtplib.SMTPDataError as e:
                        # 550 5.4.5 = limite giornaliero Gmail raggiunto: ci si ferma subito
                        log(f"Gmail ha rifiutato l'invio ({e.smtp_code}): mi fermo per oggi.")
                        cambiato = True
                        break
                    cambiato = True
                    if i < len(da_mandare) - 1:
                        time.sleep(random.uniform(3, 6))
            finally:
                if smtp:
                    try:
                        smtp.quit()
                    except Exception:
                        pass

    if PROVA:
        print("[PROVA] nessun file salvato.")
        return
    if cambiato:
        drive.scrivi(id_csv, csv_testo(righe).encode("utf-8"), "text/csv")
    if righe_log and id_log:
        vecchio = drive.leggi(id_log).decode("utf-8", "replace")
        drive.scrivi(id_log, (vecchio.rstrip("\n") + "\n" + "\n".join(righe_log) + "\n").encode("utf-8"), "text/plain")


if __name__ == "__main__":
    try:
        main()
    except KeyError as e:
        print("Manca la variabile segreta", e)
        sys.exit(1)
