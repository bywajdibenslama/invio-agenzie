# Invio agenzie con GitHub Actions

Questo programma sostituisce lo script di Google Apps Script e manda le email dal tuo Gmail
(bywajdibenslama@gmail.com) collegandosi direttamente al server di Gmail. In questo modo il
limite non è più 100 email al giorno, e il numero sale da solo con questa rampa:

| Dal          | Email al giorno |
|--------------|-----------------|
| 10 novembre  | 150 |
| 17 novembre  | 200 |
| 24 novembre  | 250 |
| 1 dicembre   | 300 |

Funziona così:
- parte ogni 15 minuti, dal lunedì al venerdì, dalle 9 alle 18 ora italiana;
- manda solo alle agenzie del Regno Unito, con il CV in inglese, prima i follow-up e poi i nuovi contatti;
- legge le risposte dalla tua casella;
- usa gli stessi file della cartella Drive "invio-agenzie".

Per cambiare la rampa modifica `RAMPA` in `invio.py`.

## Configurazione (circa 20 minuti, una volta sola)

### 1. Password per le app di Gmail
1. Vai su myaccount.google.com, poi Sicurezza. Controlla che la Verifica in due passaggi sia attiva.
2. Vai su myaccount.google.com/apppasswords e crea una password con il nome "GitHub invio".
3. Copia le 16 lettere.

### 2. Chiave per Google Drive (service account)
1. Vai su console.cloud.google.com e crea un progetto chiamato "invio-agenzie".
2. Apri "API e servizi", poi "Libreria". Cerca **Google Drive API** e premi Abilita.
3. Apri "IAM e amministrazione", poi "Account di servizio", poi **Crea account di servizio**.
   Come nome scrivi "invio". Non serve assegnare ruoli.
4. Apri l'account appena creato, vai su **Chiavi**, poi Aggiungi chiave, poi Crea nuova chiave, e scegli **JSON**.
   Si scarica un file `.json`.
5. Copia l'indirizzo email dell'account di servizio (finisce in `.iam.gserviceaccount.com`).
6. Su Google Drive apri la cartella **invio-agenzie**, scegli Condividi, incolla quell'indirizzo
   e dagli il ruolo **Editor**.

### 3. Repository su GitHub
1. Su github.com crea un nuovo repository **privato** chiamato `invio-agenzie`.
2. Carica i file di questa cartella: `invio.py`, `requirements.txt` e la cartella `.github/workflows/invio.yml`.
3. Apri Settings, poi Secrets and variables, poi Actions, poi **New repository secret**, e crea questi tre segreti:
   - `GMAIL_USER` con il valore `bywajdibenslama@gmail.com`
   - `GMAIL_APP_PASSWORD` con le 16 lettere del punto 1
   - `GDRIVE_SA_JSON` con tutto il contenuto del file `.json` del punto 2 (aprilo con un editor di testo, copia e incolla)

### 4. Prova senza spedire
Apri **Actions**, poi "Invio agenzie", poi **Run workflow**, scrivi `1` nel campo "prova" e premi Run.
Nel registro dell'esecuzione devono comparire le righe `[PROVA] ...` con gli indirizzi
che riceverebbero le email. In questa prova non viene spedito né salvato niente.

### 5. Spegni lo script vecchio, poi attiva quello nuovo
1. In Apps Script esegui **ferma**: i due programmi non devono lavorare insieme.
2. Su GitHub l'invio automatico parte da solo all'orario previsto. Per farlo partire subito:
   Run workflow, con il campo "prova" lasciato a `0`.

## Fermare tutto
Apri Actions, poi "Invio agenzie", poi i tre puntini, poi **Disable workflow**.

## Note
- Il limite di Gmail è 500 email al giorno: la rampa non va mai oltre 300, e il programma non supera mai 450.
- Se Gmail rifiuta un invio per il limite, il programma si ferma fino al giorno dopo.
- Con l'ora legale, dall'ultima domenica di marzo, cambia la riga `cron` nel file `.github/workflows/invio.yml`
  come indicato nel commento.
