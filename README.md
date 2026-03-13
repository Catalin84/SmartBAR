<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/07686a78-dd3c-476c-8fc6-2c778c051f2a" />

BAR.OS
Smart Dispenser System
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Documentație completă — Instalare, Configurare & Referință API
v2.0  •  Raspberry Pi + Flask + Vanilla JS

 
1. Prezentare Generală
BAR.OS este un sistem de dispensare automată a băuturilor, construit pe Raspberry Pi. Un server Flask controlează pompe peristaltice prin pini GPIO, iar interfața web (tablet/desktop) permite selectarea băuturii, dozei și pornirea turnării în timp real.

Arhitectura sistemului
Componentă	Rol
server.py	API Flask pe Raspberry Pi — controlează GPIO și pompele
index.html / app.js	Interfața principală pentru clienți (tabletă/browser)
admin.html / admin.js	Panou de administrare — configurare băuturi, GPIO, server
localStorage	Stocarea configurației în browser (fără backend suplimentar)

ℹ	Cerințe minime hardware
Raspberry Pi 3B+ / 4 • Modul releu (4–8 canale) • Pompe peristaltice 12V • Alimentator 12V • Tabletă/PC cu browser modern

2. Structura Repository Git
baros/
├── server.py          # API Flask — Raspberry Pi
├── requirements.txt   # Dependențe Python
├── index.html         # Interfața client principală
├── app.js             # Logica client (pour, animații, debug)
├── style.css          # Tema dark UI
├── admin.html         # Panou Admin
├── admin.js           # Logica admin (GPIO, server, băuturi)
├── admin.css          # Stiluri admin
├── .gitignore
└── README.md

 
3. Instalare
3.1  Clonare repository
# Clonează proiectul pe Raspberry Pi
git clone https://github.com/utilizator/baros.git
cd baros

3.2  Dependențe Python (Raspberry Pi)
Creează un fișier requirements.txt cu următorul conținut:
flask>=2.3.0
flask-cors>=4.0.0
RPi.GPIO>=0.7.1

Instalează dependențele:
# Creează un virtual environment (recomandat)
python3 -m venv venv
source venv/bin/activate

# Instalează pachetele
pip install -r requirements.txt

⚠	RPi.GPIO doar pe Raspberry Pi
Pachetul RPi.GPIO funcționează doar pe hardware Raspberry Pi. Pentru testare pe PC, activează modul Simulare din Admin → Server.

3.3  Pornire server Flask
# Asigură-te că ești în directorul proiectului
cd baros

# Activează venv dacă nu e activ
source venv/bin/activate

# Pornește serverul
python3 server.py

La pornire corectă, vei vedea în terminal:
╔══════════════════════════════════════╗
║   BAR.OS — Dispenser API  v2.0       ║
╚══════════════════════════════════════╝
  Băuturi  : ['vodka', 'whisky', 'rum', 'gin']
  Debit    : 1.5 ml/s
  Releu    : ACTIVE LOW
  Server   : http://0.0.0.0:5000

✓ GPIO inițializat — toate pompele OPRITE
 * Running on http://0.0.0.0:5000

3.4  Pornire automată la boot (systemd)
Pentru ca serverul să pornească automat la fiecare repornire a Pi-ului:
# Creează fișierul de serviciu
sudo nano /etc/systemd/system/baros.service

Conținut fișier serviciu:
[Unit]
Description=BAR.OS Dispenser API
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/baros
ExecStart=/home/pi/baros/venv/bin/python3 /home/pi/baros/server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target

# Activează și pornește serviciul
sudo systemctl daemon-reload
sudo systemctl enable baros
sudo systemctl start baros

# Verifică statusul
sudo systemctl status baros

# Vezi log-urile live
sudo journalctl -u baros -f
[BAR.OS_Documentatie.docx](https://github.com/user-attachments/files/25979776/BAR.OS_Documentatie.docx)

3.5  Interfața web (client)
Fișierele index.html, app.js și style.css pot fi servite direct din același folder pe Pi sau de pe orice server web static.

# Opțiunea 1 — server Python simplu (pentru testare)
python3 -m http.server 8080
# Accesează: http://IP_RASPBERRY:8080

# Opțiunea 2 — Nginx (producție)
sudo apt install nginx
sudo cp -r /home/pi/baros /var/www/html/baros
# Accesează: http://IP_RASPBERRY/baros
 
4. Configurare din Admin UI
Deschide admin.html în browser. Toate setările se salvează în localStorage și sunt citite automat de app.js.

4.1  Tab Băuturi
Adaugă și editează băuturile disponibile pe dispenser. Câmpuri obligatorii:
•	Nume — afișat în interfața clientului
•	ID — cheia folosită în API (ex: vodka, whisky). Trebuie să fie litere mici, fără spații
•	Pin GPIO — pinul BCM al Raspberry Pi conectat la releul pompei
•	Culoare accent — culoarea temei vizuale pentru băutura respectivă

ℹ	ID-ul trebuie să corespundă cu server.py
ID-ul setat în Admin și cheia din DRINK_PINS în server.py trebuie să fie identice. Folosește tab-ul GPIO pentru a genera automat configurația.

4.2  Tab GPIO — Mapare Pini Releu
Oferă control vizual complet asupra alocării pinilor GPIO:
•	Selectează pinul BCM pentru fiecare băutură dintr-un dropdown
•	Pinii deja alocați sunt dezactivați automat — imposibil de alocat același pin de două ori
•	Pinout vizual Raspberry Pi — verde = liber, colorat = ocupat
•	Generează automat blocul de configurație pentru server.py — copiabil cu un click

Configurație generată (exemplu)
DRINK_PINS = {
    'vodka':  17,   # Vodka
    'whisky': 27,   # Whisky
    'rum':    22,   # Rum
    'gin':    23,   # Gin
}

FLOW_RATE_ML_PER_SEC = 1.5
RELAY_ACTIVE_HIGH    = False

# În app.run(): host='192.168.1.111', port=5000

4.3  Tab Server — Setări Hardware
Setare	Descriere
IP / Hostname Pi	Adresa Pi pe rețea. Ex: 192.168.1.111 sau raspberrypi.local
Port	Portul Flask (default: 5000)
Mod simulare	Dacă e activat, apelurile API sunt simulate — pentru testare fără hardware
Debit pompă (ml/s)	Debitul real al pompei tale — folosit pentru calculul duratei de turnare
ms per ml	Calculat automat din debit. Folosit de bara de progres din UI
Relay Logic	ACTIVE LOW (module clasice) sau ACTIVE HIGH (SSR/MOSFET)
Ping /status	Testează conexiunea live la server-ul Flask de pe Pi

Relay Logic — cum alegi
Tip modul	Setare corectă
Module relay clasice (albastru/roșu, cu optocuplor)	ACTIVE LOW
Solid State Relay (SSR)	ACTIVE HIGH
MOSFET fără inversare	ACTIVE HIGH
Orice modul unde IN=LOW activează releul	ACTIVE LOW

⚠	Relay Logic greșit = pompele nu funcționează corect
Dacă relay logic e setat greșit, pompele pot sta pornite în permanență sau să nu pornească deloc. Verifică datasheet-ul modulului tău.
 
5. Configurare server.py Manual
Dacă preferi editare directă (fără Admin UI), modifică secțiunea CONFIGURATION din server.py:

# ════════════════════════════════════════
# CONFIGURATION
# ════════════════════════════════════════

# Map drink IDs → GPIO BCM pin numbers
DRINK_PINS = {
    'vodka':  17,
    'whisky': 27,
    'rum':    22,
    'gin':    23,
}

# Debit pompă în ml/secundă
FLOW_RATE_ML_PER_SEC = 1.5

# False = ACTIVE LOW  (module relay clasice)
# True  = ACTIVE HIGH (SSR, MOSFET)
RELAY_ACTIVE_HIGH = False

# Host/port server
SERVER_HOST = '0.0.0.0'
SERVER_PORT = 5000

ℹ	Repornire necesară
Orice modificare în server.py necesită repornirea procesului Flask pentru a fi aplicată. Cu systemd: sudo systemctl restart baros

5.1  Calibrarea debitului pompei
Pașii pentru determinarea valorii corecte FLOW_RATE_ML_PER_SEC:
1.	Pornește pompa manual timp de exact 10 secunde
2.	Măsoară volumul pompat cu un recipient gradat
3.	Împarte volumul (ml) la 10 secunde = debit real
4.	Setează valoarea în Admin → Calibrare Pompă sau direct în server.py

✓	Exemplu de calcul
Pompa a turnat 18ml în 10 secunde → FLOW_RATE_ML_PER_SEC = 1.8   |   Pentru 40ml: durata = 40 / 1.8 = 22.2 secunde
 
6. Referință API
Serverul Flask expune 4 endpoint-uri HTTP pe portul configurat (default 5000).

GET /pour
Activează pompa și dispensează cantitatea specificată. Blochează până la finalizare — răspunsul HTTP este trimis doar după ce turnarea s-a terminat.

Parametru	Descriere
drink (string, obligatoriu)	ID-ul băuturii. Trebuie să existe în DRINK_PINS
ml (integer, obligatoriu)	Volum în mililitri. Interval valid: 1–500

Răspuns succes (200)
{
  "status":   "ok",
  "drink":    "vodka",
  "ml":       40,
  "duration": 26.67,
  "pin":      17
}

Răspunsuri eroare
HTTP Status	Cauză
400 Bad Request	Parametru drink lipsă, ID necunoscut sau ml invalid
400 Bad Request	Băutura nu are pin GPIO alocat
409 Conflict	Dispensatorul este deja ocupat (altă turnare în curs)
500 Internal Server Error	Eroare GPIO sau altă excepție Python
503 Service Unavailable	DRINK_PINS gol — serverul neconfigurat

GET /status
Returnează starea curentă a dispenser-ului. Folosit de butonul Ping din Admin UI.

{
  "status":     "ready",         // sau "busy"
  "drinks":     ["vodka", "gin"],
  "flow_rate":  1.5,
  "relay":      "active_low",    // sau "active_high"
  "configured": true
}

GET /pins
Returnează maparea completă drink→pin. Util pentru debug și verificare configurație.

{
  "drink_pins":             { "vodka": 17, "whisky": 27 },
  "relay_active_high":      false,
  "flow_rate_ml_per_sec":   1.5
}

GET /
Health check simplu — verifică dacă serverul rulează.

{
  "service":    "BAR.OS Dispenser API",
  "version":    "2.0",
  "configured": true
}
 
7. Debug & Troubleshooting
7.1  Panoul de Debug din UI
Interfața client include un panou de debug integrat. Apasă butonul 🔧 din colțul dreapta-jos pentru a-l deschide. Afișează în timp real:
•	URL-ul exact apelat la fiecare pour (→ GET http://...)
•	HTTP status și timp de răspuns (← HTTP 200 OK, 1234ms)
•	Body-ul complet al răspunsului de la server
•	Tipul exact de eroare network (CORS, timeout, conexiune refuzată)
•	Configurația încărcată la init (apiBase, simulate, băuturi, doze)

Butonul 📋 Copy din panoul de debug copiază toate log-urile în clipboard pentru trimitere sau analiză.

7.2  Probleme frecvente
"Could not reach the dispenser" / CORS Error
🔴	Simptom
Bara de progres ajunge la 100% dar apare eroare. Log: "TypeError: Failed to fetch"

•	Verifică că IP-ul din Admin → Server este corect (ex: 192.168.1.111, nu raspberrypi.local dacă mDNS nu merge)
•	Verifică că server.py rulează pe Pi: ssh pi@IP_PI; ps aux | grep server.py
•	Asigură-te că flask-cors este instalat: pip show flask-cors
•	Verifică că portul 5000 nu este blocat de firewall: sudo ufw status

Timeout după 90 de secunde
🔴	Simptom
Log: "Request timed out". Bara se oprește, eroare după 90s.

•	Pi-ul este offline sau server.py s-a oprit
•	Verifică: ping IP_RASPBERRY din PC/tabletă
•	Verifică serviciul systemd: sudo systemctl status baros

Pompa nu pornește
🔴	Simptom
API returnează "ok" dar pompa nu se activează fizic

•	Relay Logic greșit — încearcă să schimbi între ACTIVE LOW și ACTIVE HIGH din Admin → Server
•	Pin GPIO greșit — verifică maparea în Admin → GPIO față de cablajul fizic
•	Verifică alimentarea modulului releu (separat de Pi)
•	Testează releul direct: python3 -c "import RPi.GPIO as GPIO; GPIO.setmode(GPIO.BCM); GPIO.setup(17,GPIO.OUT); GPIO.output(17,GPIO.LOW)"

Pompa se oprește prea devreme sau prea târziu
⚠	Simptom
Cantitatea turnată nu corespunde cu ml-ul selectat

•	Debitul pompei (FLOW_RATE_ML_PER_SEC) nu este calibrat corect
•	Recalibrează conform secțiunii 5.1 — măsoară debitul real al pompei tale
•	Temperatura fluidului și vâscozitatea influențează debitul — recalibrează cu lichidul real

Eroare "DRINK_PINS gol" (503)
⚠	Simptom
Server returnează 503. Log server: "DRINK_PINS este gol!"

•	Serverul pornit fără configurație. Adaugă băuturile din Admin UI
•	Copiază configurația generată din Admin → GPIO → "Config generată" în server.py
•	Repornește server.py după modificare
 
8. Fluxul unei turnări (Flow)

Pas	Descriere
1. Selectare băutură	Client apasă pe cardul băuturii → ecran de doze
2. Selectare doză	Client alege cantitatea (ml) → apasă POUR
3. Request HTTP	app.js → GET /pour?drink=vodka&ml=40 → server Flask
4. Validare server	Flask verifică drink ID, ml, disponibilitate pompă
5. GPIO activare	Flask pune pinul releului în PUMP_ON (HIGH sau LOW)
6. Sleep	Flask așteaptă duration = ml / FLOW_RATE_ML_PER_SEC
7. GPIO dezactivare	Flask pune pinul în PUMP_OFF — pompa se oprește
8. Răspuns JSON	Flask trimite { status: "ok", ml, duration, pin }
9. UI update	app.js afișează "ENJOY YOUR DRINK", sună chime-ul
10. Auto-return	Interfața revine la home după 4 secunde
 
9. Pini GPIO Validi (BCM)
Sistemul acceptă doar pinii GPIO din lista de mai jos (pini BCM de uz general):

Pini valizi BCM:
  4,  5,  6, 12, 13, 16,
 17, 18, 19, 20, 21, 22,
 23, 24, 25, 26, 27

Total: 17 pini disponibili → maxim 17 băuturi/pompe simultane

NU folosi: 2, 3 (I2C) • 14, 15 (UART) • 10, 9, 11 (SPI)
           dacă ai alte dispozitive conectate pe aceste interfețe

10. Actualizare & Backup
Actualizare cod din Git
cd /home/pi/baros

# Oprește serviciul
sudo systemctl stop baros

# Pull ultimele modificări
git pull origin main

# Actualizează dependențele dacă e nevoie
source venv/bin/activate
pip install -r requirements.txt

# Repornește serviciul
sudo systemctl start baros
sudo systemctl status baros

Backup configurație localStorage
Configurația (băuturi, doze, setări) e stocată în localStorage-ul browser-ului. Pentru backup:
•	Deschide Admin → tab Server → secțiunea "Config generată" → copiază și salvează
•	Sau exportă din DevTools: F12 → Application → Local Storage → copiază valorile baros_drinks, baros_doses, baros_settings

ℹ	localStorage nu se sincronizează între dispozitive
Dacă configurezi de pe o tabletă și accesezi admin.html de pe alt dispozitiv, va fi gol. Configurează întotdeauna de pe același browser.
 
11. Note de Securitate
⚠	Rețea locală only
Serverul Flask nu are autentificare. Nu expune portul 5000 pe internet. Folosește exclusiv în rețeaua locală (LAN/WiFi privat).

•	Serverul Flask acceptă conexiuni de pe orice IP (0.0.0.0) — izolează rețeaua WiFi a dispenser-ului dacă e necesar
•	CORS este activat pentru toate originile (*) — modifică în server.py dacă vrei restricții
•	Nu stoca date sensibile în localStorage — e accesibil oricărui script din aceeași origine

12. Licență
BAR.OS este open source, distribuit sub licența MIT.

Contribuții, bug reports și pull requests sunt binevenite pe GitHub.

━━━━━━━━━━━━━━━━━━━━━━━━━━
BAR.OS v2.0  •  Documentație generată automat
