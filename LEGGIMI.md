# Invio agenzie con GitHub Actions

Sostituisce lo script di Apps Script e manda le email dal tuo Gmail usando l'accesso con Google
(niente password da copiare). La quantità sale da sola:

| Dal          | Email al giorno |
|--------------|-----------------|
| 10 novembre  | 150 |
| 17 novembre  | 200 |
| 24 novembre  | 250 |
| 1 dicembre   | 300 |

- Parte ogni 15 minuti, dal lunedì al venerdì, dalle 9 alle 18 ora italiana.
- Scrive solo alle agenzie del Regno Unito, con il CV in inglese: prima i follow-up, poi i nuovi contatti.
- Legge risposte e rimbalzi dalla tua casella e usa la cartella Drive "invio-agenzie".

## Configurazione (una volta sola)

### 1. Crea l'accesso con Google (circa 5 minuti, solo clic)
1. Vai su console.cloud.google.com e crea un progetto chiamato "invio-agenzie".
2. Apri "API e servizi", poi "Libreria", e abilita **Gmail API** e **Google Drive API**.
3. Apri "API e servizi", poi "Schermata consenso OAuth":
   - tipo **Esterno**;
   - nome app "Invio agenzie", con la tua email nei campi richiesti;
   - quando hai finito, premi **Pubblica app**. Se lasci lo stato "Test", l'accesso scade ogni 7 giorni.
4. Apri "API e servizi", poi "Credenziali", poi "Crea credenziali", poi **ID client OAuth**:
   - tipo **App desktop**;
   - poi **Scarica JSON**: si scarica il file `client_secret_....json`.

### 2. Autorizza (un minuto)
Nel Terminale del Mac, nella cartella dove hai scaricato i file:

    python3 autorizza.py client_secret_....json

Si apre il browser:
1. scegli bywajdibenslama@gmail.com;
2. Google mostra un avviso perché l'app è tua e non è stata verificata: premi **Avanzate**, poi **Vai a Invio agenzie**;
3. premi **Consenti**.

Lo script salva da solo il segreto su GitHub se sul Mac hai il comando `gh`.
Se non ce l'hai, copia il token negli appunti e apre la pagina giusta: incolla e premi Add secret.

### 3. Spegni lo script vecchio, poi attiva quello nuovo
1. In Apps Script esegui **ferma**.
2. Su GitHub apri Actions, poi "Invio agenzie", poi **Enable workflow**.

## Fermare tutto
Apri Actions, poi "Invio agenzie", poi i tre puntini, poi **Disable workflow**.

## Note
- Il limite di Gmail è 500 email al giorno: la rampa si ferma a 300, e il programma non supera mai 450.
- Per cambiare la rampa modifica `RAMPA` in `invio.py`.
- Dall'ultima domenica di marzo (ora legale) cambia la riga `cron` nel file del workflow, come indicato nel commento.
