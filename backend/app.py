from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import sqlite3
import threading
import time
import os
from datetime import datetime

# Servir archivos estáticos desde la carpeta fronted (sin static_url_path para controlar rutas manualmente)
app = Flask(__name__, static_folder="../fronted")
CORS(app)

# URL por defecto (se puede sobreescribir vía /config o por el body en /test_gs)
API_URL = "https://script.google.com/macros/s/AKfycbwSLQWgSxHy51_vVopRyKss0UlrqCuKpO8LhxaEBztzsk-Idc-_LnvjsT5dUEwTlb9r/exec"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(BASE_DIR, "..", "db")
INTERVALO_SYNC = 600  # 10 minutos en segundos

# ============ CONFIGURACIÓN DE MÓDULOS ============
# Cada módulo tiene su PROPIA base de datos SQLite y su hoja de Google Sheets
MODULOS = {
    "cajaMenor": {
        "db": os.path.join(DB_DIR, "cajaMenor.db"),
        "tabla": "movimientos",
        "hoja_sheets": "CajaMenor"
    },
    "libroDiario": {
        "db": os.path.join(DB_DIR, "libroDiario.db"),
        "tabla": "movimientos",
        "hoja_sheets": "libroDiario"
    }
}

# ============ BASE DE DATOS ============
def get_db(modulo):
    """Abre la base de datos del módulo indicado"""
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(modulo["db"])
    conn.row_factory = sqlite3.Row
    return conn

def inicializar_db():
    for modulo in MODULOS.values():
        conn = get_db(modulo)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {modulo["tabla"]} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha TEXT NOT NULL,
                tipo TEXT NOT NULL,
                descripcion TEXT NOT NULL,
                monto INTEGER NOT NULL,
                sincronizado INTEGER DEFAULT 0,
                borrado INTEGER DEFAULT 0,
                creado_en TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        conn.close()

    # Migración para DBs existentes: agregar columna borrado si no existe
    for modulo in MODULOS.values():
        conn = get_db(modulo)
        columnas = [c[1] for c in conn.execute(f"PRAGMA table_info({modulo['tabla']})").fetchall()]
        if "borrado" not in columnas:
            conn.execute(f"ALTER TABLE {modulo['tabla']} ADD COLUMN borrado INTEGER DEFAULT 0")
            conn.commit()
        conn.close()

# ============ SERVIR EL FRONTEND ============
import os.path

@app.route("/")
def index():
    return send_from_directory(os.path.join(app.static_folder, "html"), "index.html")

@app.route("/<path:archivo>")
def archivos_estaticos(archivo):
    base_dir = app.static_folder
    
    # Extraer solo el nombre del archivo (sin carpetas previas)
    nombre_archivo = os.path.basename(archivo)
    
    # Determinar en qué carpeta buscar según la extensión
    if nombre_archivo.endswith(".html"):
        carpeta = "html"
    elif nombre_archivo.endswith(".css"):
        carpeta = "css"
    elif nombre_archivo.endswith(".js"):
        carpeta = "js"
    else:
        carpeta = ""
    
    ruta_completa = os.path.join(base_dir, carpeta, nombre_archivo) if carpeta else os.path.join(base_dir, nombre_archivo)
    
    # Debug: log en consola
    print(f"[STATIC] Recibido: {archivo} | Buscando: {ruta_completa}")
    
    if os.path.exists(ruta_completa):
        directorio = os.path.dirname(ruta_completa)
        nombre_archivo_final = os.path.basename(ruta_completa)
        return send_from_directory(directorio, nombre_archivo_final)
    else:
        return f"Archivo no encontrado: {ruta_completa}", 404

# ============ LEER MOVIMIENTOS (desde SQLite - instantáneo) ============
@app.route("/leer", methods=["GET"])
def leer():
    nombre = request.args.get("hoja", "cajaMenor")
    modulo = MODULOS.get(nombre)
    if not modulo:
        return jsonify({"error": f"Módulo '{nombre}' no existe"}), 400

    conn = get_db(modulo)
    filas = conn.execute(
        f"SELECT * FROM {modulo['tabla']} WHERE borrado = 0 ORDER BY fecha DESC, id DESC"
    ).fetchall()
    conn.close()

    datos = [
        {
            "id": fila["id"],
            "Fecha": fila["fecha"],
            "Tipo": fila["tipo"],
            "Descripción": fila["descripcion"],
            "Monto": fila["monto"],
            "sincronizado": fila["sincronizado"]
        }
        for fila in filas
    ]
    return jsonify({"datos": datos})

# ============ GUARDAR MOVIMIENTO (SQLite - instantáneo) ============
@app.route("/guardar", methods=["POST"])
def guardar():
    body = request.json
    nombre = body.get("hoja", "cajaMenor")
    modulo = MODULOS.get(nombre)
    if not modulo:
        return jsonify({"error": f"Módulo '{nombre}' no existe"}), 400

    datos = body.get("datos", {})

    conn = get_db(modulo)
    cursor = conn.execute(
        f"INSERT INTO {modulo['tabla']} (fecha, tipo, descripcion, monto) VALUES (?, ?, ?, ?)",
        (
            datos.get("Fecha", ""),
            datos.get("Tipo", ""),
            datos.get("Descripción", ""),
            int(float(datos.get("Monto", 0)))
        )
    )
    conn.commit()
    nuevo_id = cursor.lastrowid
    conn.close()

    return jsonify({"ok": True, "id": nuevo_id, "mensaje": "Guardado localmente, se sincronizará con Google Sheets"})

# ============ ACTUALIZAR MOVIMIENTO ============
@app.route("/actualizar", methods=["PUT"])
def actualizar():
    body = request.json
    nombre = body.get("hoja")
    modulo = MODULOS.get(nombre)
    if not modulo:
        return jsonify({"error": f"Módulo '{nombre}' no existe"}), 400

    datos = body.get("datos", {})
    id_reg = body.get("id")

    conn = get_db(modulo)
    fila = conn.execute(f"SELECT sincronizado FROM {modulo['tabla']} WHERE id = ?", (id_reg,)).fetchone()
    if not fila:
        conn.close()
        return jsonify({"error": "Registro no encontrado"}), 404

    conn.execute(
        f"UPDATE {modulo['tabla']} SET fecha=?, tipo=?, descripcion=?, monto=? WHERE id=?",
        (
            datos.get("Fecha", ""),
            datos.get("Tipo", ""),
            datos.get("Descripción", ""),
            int(float(datos.get("Monto", 0))),
            id_reg
        )
    )
    # Si ya había subido a Sheets, marcar pendiente para que el sync lo actualice allá
    if fila["sincronizado"] == 1:
        conn.execute(f"UPDATE {modulo['tabla']} SET sincronizado = 0 WHERE id = ?", (id_reg,))

    conn.commit()
    conn.close()
    return jsonify({"ok": True})

# ============ BORRAR MOVIMIENTO ============
@app.route("/borrar", methods=["DELETE"])
def borrar():
    body = request.json
    nombre = body.get("hoja")
    modulo = MODULOS.get(nombre)
    if not modulo:
        return jsonify({"error": f"Módulo '{nombre}' no existe"}), 400

    id_reg = body.get("id")

    conn = get_db(modulo)
    fila = conn.execute(f"SELECT sincronizado FROM {modulo['tabla']} WHERE id = ?", (id_reg,)).fetchone()
    if not fila:
        conn.close()
        return jsonify({"error": "Registro no encontrado"}), 404

    if fila["sincronizado"] == 1:
        # Ya está en Sheets: soft delete, el sync lo borrará allá
        conn.execute(f"UPDATE {modulo['tabla']} SET borrado = 1, sincronizado = 0 WHERE id = ?", (id_reg,))
    else:
        # Nunca subió a Sheets: borrado definitivo
        conn.execute(f"DELETE FROM {modulo['tabla']} WHERE id = ?", (id_reg,))

    conn.commit()
    conn.close()
    return jsonify({"ok": True})

# ============ SINCRONIZACIÓN CON GOOGLE SHEETS (background) ============
def sincronizar_tabla(nombre_modulo, modulo):
    """Sube los pendientes de un módulo a su hoja de Google Sheets"""
    conn = get_db(modulo)
    pendientes = conn.execute(
        f"SELECT * FROM {modulo['tabla']} WHERE sincronizado = 0"
    ).fetchall()

    if not pendientes:
        conn.close()
        return 0

    ids_ok = []
    for fila in pendientes:
        # Determinar la acción: borrar / actualizar / nuevo
        if fila["borrado"] == 1:
            accion = "borrar"
            datos = None
        else:
            # Si la última columna Sheets ya la tiene, es actualizar; si no, nuevo
            # (el Apps Script busca por id; si no existe, agrega fila nueva)
            accion = "actualizar"
            datos = {
                "Fecha": fila["fecha"],
                "Tipo": fila["tipo"],
                "Descripción": fila["descripcion"],
                "Monto": str(fila["monto"])
            }

        payload = {
            "hoja": modulo["hoja_sheets"],
            "accion": accion,
            "id": fila["id"],
            "datos": datos
        }

        try:
            respuesta = requests.post(API_URL, json=payload, allow_redirects=True, timeout=30)
            print(f"[SYNC] POST {nombre_modulo} id={fila['id']} status={respuesta.status_code} content-type={respuesta.headers.get('content-type','?')}")
            if respuesta.status_code != 200 or "html" in respuesta.headers.get("content-type", "").lower():
                print(f"[SYNC] Respuesta inesperada (HTML?): {respuesta.text[:300]}")
                continue
            resultado = respuesta.json()
            if resultado.get("ok"):
                if fila["borrado"] == 1:
                    # Borrado exitoso en Sheets → eliminar definitivamente de SQLite
                    conn.execute(f"DELETE FROM {modulo['tabla']} WHERE id = ?", (fila["id"],))
                    conn.commit()
                    print(f"[SYNC] {nombre_modulo}: id {fila['id']} borrado de Google Sheets ({resultado.get('mensaje', '')})")
                else:
                    ids_ok.append(fila["id"])
            else:
                print(f"[SYNC] Apps Script respondió error: {resultado}")
        except Exception as e:
            print(f"[SYNC] Error subiendo {nombre_modulo} id {fila['id']}: {e}")

    if ids_ok:
        placeholders = ",".join("?" * len(ids_ok))
        conn.execute(f"UPDATE {modulo['tabla']} SET sincronizado = 1 WHERE id IN ({placeholders})", ids_ok)
        conn.commit()
        print(f"[SYNC {datetime.now().strftime('%H:%M:%S')}] {nombre_modulo}: {len(ids_ok)} registros subidos a Google Sheets")

    conn.close()
    return len(pendientes) - len(ids_ok)  # cuántos quedaron pendientes

def sincronizar_pendientes():
    """Sincroniza todos los módulos con Google Sheets"""
    total_pendientes = 0
    for nombre, modulo in MODULOS.items():
        total_pendientes += sincronizar_tabla(nombre, modulo)

    if total_pendientes == 0:
        print(f"[SYNC {datetime.now().strftime('%H:%M:%S')}] Todo sincronizado")
    return total_pendientes

def ciclo_sincronizacion():
    """Hilo que corre la sincronización cada INTERVALO_SYNC segundos"""
    while True:
        time.sleep(INTERVALO_SYNC)
        sincronizar_pendientes()

# ============ FORZAR SINCRONIZACIÓN MANUAL ============
@app.route("/sincronizar", methods=["POST"])
def sincronizar_ahora():
    pendientes = sincronizar_pendientes()
    return jsonify({"ok": True, "pendientes": pendientes})

# ============ MARCAR TODO COMO PENDIENTE (re-subir a Sheets) ============
@app.route("/reset_sync", methods=["POST"])
def reset_sync():
    """Marca todos los registros activos como no sincronizados.
    Útil después de limpiar la hoja de Google para re-subir todo desde cero."""
    body = request.json or {}
    nombre = body.get("hoja")
    if nombre:
        modulo = MODULOS.get(nombre)
        if not modulo:
            return jsonify({"error": f"Módulo '{nombre}' no existe"}), 400
        modulos = {nombre: modulo}
    else:
        modulos = MODULOS

    total = 0
    for modulo in modulos.values():
        conn = get_db(modulo)
        cursor = conn.execute(f"UPDATE {modulo['tabla']} SET sincronizado = 0 WHERE borrado = 0")
        total += cursor.rowcount
        conn.commit()
        conn.close()

    return jsonify({"ok": True, "marcados": total, "mensaje": "Ahora llama a /sincronizar para re-subir todo"})

# ============ CONFIGURAR URL DE GOOGLE SHEETS ============
@app.route("/config", methods=["POST"])
def configurar_url():
    """Permite cambiar la URL de Apps Script en runtime."""
    global API_URL
    body = request.json or {}
    url = body.get("api_url")
    if not url:
        return jsonify({"error": "Falta api_url en el body"}), 400
    API_URL = url
    return jsonify({"ok": True, "api_url": API_URL})

# ============ PROBAR CONEXIÓN DIRECTA A GOOGLE SHEETS ============
@app.route("/test_gs", methods=["POST"])
def test_gs():
    """Endpoint para probar manualmente una URL de Apps Script.
    Si envías api_url en el body, se usa esa URL; si no, la global.
    """
    body = request.json or {}
    url = body.get("api_url", API_URL)
    payload = {
        "hoja": body.get("hoja", "CajaMenor"),
        "accion": body.get("accion", "nuevo"),
        "id": body.get("id", "777"),
        "datos": body.get("datos", {
            "Fecha": "2026-09-03",
            "Tipo": "Ingreso",
            "Descripción": "Prueba backend",
            "Monto": "1"
        })
    }
    try:
        respuesta = requests.post(url, json=payload, allow_redirects=True, timeout=30)
        return jsonify({
            "url_usada": url,
            "status": respuesta.status_code,
            "content_type": respuesta.headers.get("content-type"),
            "primeros_300_chars": respuesta.text[:300],
            "json_parseable": respuesta.headers.get("content-type", "").lower().startswith("application/json")
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ============ INICIO ============
if __name__ == "__main__":
    inicializar_db()
    # Lanzar el hilo de sincronización
    hilo = threading.Thread(target=ciclo_sincronizacion, daemon=True)
    hilo.start()
    print(f"🚀 Servidor iniciado. Sincronización con Google Sheets cada {INTERVALO_SYNC // 60} minutos")
    print(f"📦 Módulos activos: {', '.join(MODULOS.keys())}")
    # Primera sincronización al arrancar (por si quedó algo pendiente de antes)
    sincronizar_pendientes()
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)

