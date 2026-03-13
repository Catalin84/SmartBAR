#!/usr/bin/env python3
"""
BAR.OS — Raspberry Pi Flask API
server.py  v2.0

Toate setările sunt configurate din panoul Admin (admin.html).
Editează secțiunea CONFIGURATION de mai jos cu valorile
generate și copiate din Admin → Server → "Configurație generată".

Usage:
  python3 server.py

API:
  GET /pour?drink=vodka&ml=40
  GET /status
  GET /pins        → returnează maparea drink→pin curentă
"""

import time
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Raspberry Pi GPIO ────────────────────────────────────────────
# Comentează linia de import și decomentează blocul Mock de mai jos
# dacă rulezi fără hardware (același lucru se poate seta din Admin UI).
import RPi.GPIO as GPIO

# ── Mock GPIO (pentru testare fără hardware) ─────────────────────
# class GPIO:
#     BCM = BOARD = OUT = IN = HIGH = LOW = 0
#     @staticmethod
#     def setmode(m):          print(f"[MOCK] setmode({m})")
#     @staticmethod
#     def setup(pin, mode):    print(f"[MOCK] setup(pin={pin})")
#     @staticmethod
#     def output(pin, val):    print(f"[MOCK] output(pin={pin}, val={val})")
#     @staticmethod
#     def cleanup():           print("[MOCK] cleanup()")

app = Flask(__name__)
CORS(app)

# ════════════════════════════════════════════════════════════════
# CONFIGURATION
# ════════════════════════════════════════════════════════════════
# ⚠ Generează această secțiune din Admin → tab GPIO / Server
#   și copiaz-o aici. Nu edita manual dacă folosești Admin UI.


DRINK_PINS = {
    'apa': 17,   # APA
    'vin': 4,   # VIN
}

# Debit pompă (ml/secundă) — setat din Admin → Calibrare Pompă
FLOW_RATE_ML_PER_SEC = 1.5

# Logică releu — setat din Admin → Logică Releu
#   False = ACTIVE LOW  (module relay clasice cu optocuplor) ← cel mai comun
#   True  = ACTIVE HIGH (SSR, MOSFET, relay fără inversare)
RELAY_ACTIVE_HIGH = False

# Host/port server Flask — setat din Admin → Conexiune API
SERVER_HOST = '0.0.0.0'   # '0.0.0.0' ascultă pe toate interfețele
SERVER_PORT = 5000

# ════════════════════════════════════════════════════════════════
# VALIDARE CONFIGURAȚIE
# ════════════════════════════════════════════════════════════════
if not DRINK_PINS:
    print("⚠  ATENȚIE: DRINK_PINS este gol!")
    print("   Configurează băuturile și pinii din Admin UI,")
    print("   copiază configurația generată și repornește serverul.")

# ════════════════════════════════════════════════════════════════
# GPIO SETUP
# ════════════════════════════════════════════════════════════════
PUMP_ON  = GPIO.HIGH if RELAY_ACTIVE_HIGH else GPIO.LOW
PUMP_OFF = GPIO.LOW  if RELAY_ACTIVE_HIGH else GPIO.HIGH

GPIO.setmode(GPIO.BCM)

for drink_id, pin in DRINK_PINS.items():
    if pin is not None:
        GPIO.setup(pin, GPIO.OUT)
        GPIO.output(pin, PUMP_OFF)
        print(f"  ✓ GPIO {pin:2d}  →  {drink_id}")

print("✓ GPIO inițializat — toate pompele OPRITE")

# ════════════════════════════════════════════════════════════════
# STATE
# ════════════════════════════════════════════════════════════════
pouring_lock = threading.Lock()
is_pouring   = False

# ════════════════════════════════════════════════════════════════
# PUMP CONTROL
# ════════════════════════════════════════════════════════════════
def run_pump(pin: int, duration_seconds: float):
    """Activează pompa pentru durata calculată, apoi o oprește."""
    try:
        GPIO.output(pin, PUMP_ON)
        print(f"⚡ Pornit  GPIO {pin} — {duration_seconds:.2f}s")
        time.sleep(duration_seconds)
    finally:
        GPIO.output(pin, PUMP_OFF)
        print(f"✓ Oprit   GPIO {pin}")

# ════════════════════════════════════════════════════════════════
# ROUTES
# ════════════════════════════════════════════════════════════════

@app.route('/pour', methods=['GET'])
def pour():
    """
    Dispensează o cantitate dintr-o băutură.

    Query params:
      drink (str) — ID băutură (trebuie să existe în DRINK_PINS)
      ml    (int) — volum în mililitri (1–500)

    Returns JSON după ce pompa termină:
      { "status": "ok",    "drink": "vodka", "ml": 40, "duration": 26.67, "pin": 17 }
      { "status": "error", "message": "..." }
    """
    global is_pouring

    drink = request.args.get('drink', '').lower().strip()
    ml    = request.args.get('ml', type=int)

    # Validare
    if not drink:
        return jsonify({'status': 'error', 'message': 'Parametru lipsă: drink'}), 400

    if not DRINK_PINS:
        return jsonify({'status': 'error', 'message': 'Server neconfigurat: DRINK_PINS gol. Configurează din Admin UI.'}), 503

    if drink not in DRINK_PINS:
        return jsonify({'status': 'error', 'message': f'Băutură necunoscută: {drink}. Disponibile: {list(DRINK_PINS.keys())}'}), 400

    pin = DRINK_PINS[drink]
    if pin is None:
        return jsonify({'status': 'error', 'message': f'Băutura {drink} nu are pin GPIO alocat'}), 400

    if ml is None or ml <= 0 or ml > 500:
        return jsonify({'status': 'error', 'message': 'ml invalid (1–500)'}), 400

    # Check busy
    if not pouring_lock.acquire(blocking=False):
        return jsonify({'status': 'error', 'message': 'Dispensatorul este ocupat, asteaptă'}), 409

    try:
        is_pouring = True
        duration   = ml / FLOW_RATE_ML_PER_SEC

        print(f"🍸 Turnare {ml}ml de {drink} — GPIO {pin} — {duration:.2f}s")

        run_pump(pin, duration)

        print("🔓 Dispenser gata")
        return jsonify({
            'status':   'ok',
            'drink':    drink,
            'ml':       ml,
            'duration': round(duration, 2),
            'pin':      pin,
        })

    except Exception as e:
        print(f"✗ Eroare la turnare: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

    finally:
        is_pouring = False
        pouring_lock.release()


@app.route('/status', methods=['GET'])
def status():
    """Starea dispenser-ului. Folosit de Admin UI pentru Ping."""
    return jsonify({
        'status':     'busy' if is_pouring else 'ready',
        'drinks':     list(DRINK_PINS.keys()),
        'flow_rate':  FLOW_RATE_ML_PER_SEC,
        'relay':      'active_high' if RELAY_ACTIVE_HIGH else 'active_low',
        'configured': bool(DRINK_PINS),
    })


@app.route('/pins', methods=['GET'])
def pins():
    """Returnează maparea drink→pin curentă. Util pentru debug."""
    return jsonify({
        'drink_pins':    DRINK_PINS,
        'relay_active_high': RELAY_ACTIVE_HIGH,
        'flow_rate_ml_per_sec': FLOW_RATE_ML_PER_SEC,
    })


@app.route('/', methods=['GET'])
def index():
    return jsonify({
        'service':    'BAR.OS Dispenser API',
        'version':    '2.0',
        'configured': bool(DRINK_PINS),
    })


# ════════════════════════════════════════════════════════════════
# SHUTDOWN CLEANUP
# ════════════════════════════════════════════════════════════════
import atexit

@atexit.register
def cleanup():
    GPIO.cleanup()
    print("GPIO curățat la ieșire.")


# ════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    print()
    print("╔══════════════════════════════════════╗")
    print("║   BAR.OS — Dispenser API  v2.0       ║")
    print("╚══════════════════════════════════════╝")
    print(f"  Băuturi  : {list(DRINK_PINS.keys()) or '⚠ NECONFIGURAT'}")
    print(f"  Debit    : {FLOW_RATE_ML_PER_SEC} ml/s")
    print(f"  Releu    : {'ACTIVE HIGH' if RELAY_ACTIVE_HIGH else 'ACTIVE LOW'}")
    print(f"  Server   : http://{SERVER_HOST}:{SERVER_PORT}")
    print()

    app.run(
        host=SERVER_HOST,
        port=SERVER_PORT,
        debug=False,
        threaded=True,
    )