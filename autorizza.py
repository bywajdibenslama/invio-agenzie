"""
Accesso con Google: da eseguire UNA VOLTA sul Mac.

    python3 autorizza.py client_secret.json

1. Si apre il browser: scegli bywajdibenslama@gmail.com e premi "Consenti".
2. Lo script crea il token e, se sul Mac c'è il comando `gh` collegato a GitHub,
   lo salva da solo come segreto GOOGLE_TOKEN_JSON del repository.
   Altrimenti lo copia negli appunti e apre la pagina dei segreti: incollalo lì.
Il token resta solo sul tuo Mac e su GitHub: non viene mostrato a schermo.
"""

import json
import shutil
import subprocess
import sys
import webbrowser

REPO = "bywajdibenslama/invio-agenzie"
SCOPES = ["https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/drive"]


def main():
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "-q", "google-auth-oauthlib"])
        from google_auth_oauthlib.flow import InstalledAppFlow

    file_client = sys.argv[1] if len(sys.argv) > 1 else "client_secret.json"
    flow = InstalledAppFlow.from_client_secrets_file(file_client, SCOPES)
    cred = flow.run_local_server(port=0, prompt="consent", access_type="offline",
                                 authorization_prompt_message="Si apre il browser: accedi con Google e premi Consenti.",
                                 success_message="Fatto! Puoi chiudere questa pagina e tornare al Terminale.")
    token = cred.to_json()
    if not json.loads(token).get("refresh_token"):
        print("Google non ha restituito il token permanente. Rilancia lo script.")
        sys.exit(1)

    if shutil.which("gh"):
        r = subprocess.run(["gh", "secret", "set", "GOOGLE_TOKEN_JSON", "-R", REPO], input=token, text=True)
        if r.returncode == 0:
            print("Segreto GOOGLE_TOKEN_JSON salvato su GitHub. Tutto pronto.")
            return
    if shutil.which("pbcopy"):
        subprocess.run(["pbcopy"], input=token, text=True)
        print("Token copiato negli appunti.")
    else:
        with open("token_google.json", "w") as f:
            f.write(token)
        print("Token salvato in token_google.json (cancellalo dopo averlo incollato).")
    url = f"https://github.com/{REPO}/settings/secrets/actions/new"
    print("Si apre GitHub: come nome scrivi GOOGLE_TOKEN_JSON, nel valore incolla (Cmd+V) e premi Add secret.")
    webbrowser.open(url)


if __name__ == "__main__":
    main()
