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
        "hoja_sheets": "CajaMenor",
        "campos": ["Fecha", "Tipo", "Descripción", "Monto"]
    },
    "libroDiario": {
        "db": os.path.join(DB_DIR, "libroDiario.db"),
        "tabla": "movimientos",
        "hoja_sheets": "libroDiario",
        "campos": ["Fecha", "Tipo", "Descripción", "Monto"]
    },
    "averias": {
        "db": os.path.join(DB_DIR, "averias.db"),
        "tabla": "averias",
        "hoja_sheets": "Averias",
        "campos": ["Fecha", "Vendedor", "Cliente", "Ciudad", "Direccion", "Valor", "Status Bodega", "Status Averias", "Fecha Envio", "Observaciones"]
    }
}

# Esquema de tablas por módulo
ESQUEMAS = {
    "movimientos": """
        CREATE TABLE IF NOT EXISTS movimientos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            tipo TEXT NOT NULL,
            descripcion TEXT NOT NULL,
            monto INTEGER NOT NULL,
            sincronizado INTEGER DEFAULT 0,
            borrado INTEGER DEFAULT 0,
            creado_en TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """,
    "averias": """
        CREATE TABLE IF NOT EXISTS averias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            vendedor TEXT NOT NULL,
            cliente TEXT NOT NULL,
            ciudad TEXT NOT NULL,
            direccion TEXT NOT NULL,
            telefono TEXT,
            valor INTEGER NOT NULL,
            status_bodega TEXT NOT NULL,
            status_averias TEXT NOT NULL,
            fecha_envio TEXT,
            observaciones TEXT,
            sincronizado INTEGER DEFAULT 0,
            borrado INTEGER DEFAULT 0,
            creado_en TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """,
    "vendedores": """
        CREATE TABLE IF NOT EXISTS vendedores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT UNIQUE NOT NULL
        )
    """
}

# ============ BASE DE DATOS ============
def get_db(modulo):
    """Abre la base de datos del módulo indicado"""
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(modulo["db"], timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn

def inicializar_db():
    for nombre, modulo in MODULOS.items():
        conn = get_db(modulo)
        # Crear tabla principal del módulo
        conn.execute(ESQUEMAS[modulo["tabla"]])
        # Si es averias, también crear tabla de vendedores
        if nombre == "averias":
            conn.execute(ESQUEMAS["vendedores"])
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

    # Convertir filas a diccionarios con claves según los campos configurados
    datos = []
    for fila in filas:
        registro = {"id": fila["id"], "sincronizado": fila["sincronizado"]}
        for campo in modulo["campos"]:
            # Convertir nombre de campo a nombre de columna SQLite (minúsculas, guiones bajos)
            columna = campo.lower().replace(" ", "_").replace("ó", "o")
            registro[campo] = fila[columna]
        datos.append(registro)
    
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
    
    # Construir query dinámicamente según los campos del módulo
    columnas = [campo.lower().replace(" ", "_").replace("ó", "o") for campo in modulo["campos"]]
    valores = [datos.get(campo, "") for campo in modulo["campos"]]
    
    # Convertir valores numéricos
    if "Monto" in modulo["campos"]:
        idx = modulo["campos"].index("Monto")
        valores[idx] = int(float(valores[idx] or 0))
    if "Valor" in modulo["campos"]:
        idx = modulo["campos"].index("Valor")
        valores[idx] = int(float(valores[idx] or 0))

    placeholders = ", ".join(["?"] * len(columnas))
    columnas_str = ", ".join(columnas)

    conn = get_db(modulo)
    cursor = conn.execute(
        f"INSERT INTO {modulo['tabla']} ({columnas_str}) VALUES ({placeholders})",
        valores
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

    # Construir SET dinámico según los campos del módulo
    columnas = [campo.lower().replace(" ", "_").replace("ó", "o") for campo in modulo["campos"]]
    valores = [datos.get(campo, "") for campo in modulo["campos"]]
    
    # Convertir valores numéricos
    if "Monto" in modulo["campos"]:
        idx = modulo["campos"].index("Monto")
        valores[idx] = int(float(valores[idx] or 0))
    if "Valor" in modulo["campos"]:
        idx = modulo["campos"].index("Valor")
        valores[idx] = int(float(valores[idx] or 0))
    
    set_clause = ", ".join([f"{col}=?" for col in columnas])
    valores.append(id_reg)

    conn.execute(
        f"UPDATE {modulo['tabla']} SET {set_clause} WHERE id=?",
        valores
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
    """Sube los pendientes de un módulo a su hoja de Google Sheets.
    Usa conexiones cortas para evitar bloquear la base de datos."""
    
    # 1) Leer pendientes con conexión corta
    conn = get_db(modulo)
    pendientes = conn.execute(
        f"SELECT * FROM {modulo['tabla']} WHERE sincronizado = 0"
    ).fetchall()
    conn.close()

    if not pendientes:
        return 0

    ids_ok = []
    for fila in pendientes:
        # Determinar la acción: borrar / actualizar / nuevo
        if fila["borrado"] == 1:
            accion = "borrar"
            datos = None
        else:
            accion = "actualizar"
            datos = {}
            for campo in modulo["campos"]:
                columna = campo.lower().replace(" ", "_").replace("ó", "o")
                valor = fila[columna]
                # Convertir campos numéricos a string para Sheets
                if campo in ["Monto", "Valor"]:
                    datos[campo] = str(valor)
                else:
                    datos[campo] = valor or ""

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
                # 2) Actualizar SQLite con conexión corta
                conn = get_db(modulo)
                if fila["borrado"] == 1:
                    conn.execute(f"DELETE FROM {modulo['tabla']} WHERE id = ?", (fila["id"],))
                    conn.commit()
                    print(f"[SYNC] {nombre_modulo}: id {fila['id']} borrado de Google Sheets ({resultado.get('mensaje', '')})")
                else:
                    conn.execute(f"UPDATE {modulo['tabla']} SET sincronizado = 1 WHERE id = ?", (fila["id"],))
                    conn.commit()
                    ids_ok.append(fila["id"])
                conn.close()
            else:
                print(f"[SYNC] Apps Script respondió error: {resultado}")
        except Exception as e:
            print(f"[SYNC] Error subiendo {nombre_modulo} id {fila['id']}: {e}")

    if ids_ok:
        print(f"[SYNC {datetime.now().strftime('%H:%M:%S')}] {nombre_modulo}: {len(ids_ok)} registros subidos a Google Sheets")

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

# ============ GESTIONAR VENDEDORES ============
@app.route("/vendedores", methods=["GET", "POST", "DELETE"])
def gestionar_vendedores():
    modulo = MODULOS.get("averias")
    if not modulo:
        return jsonify({"error": "Módulo averias no configurado"}), 500

    conn = get_db(modulo)

    if request.method == "GET":
        # Listar todos los vendedores
        vendedores = conn.execute("SELECT * FROM vendedores ORDER BY nombre").fetchall()
        conn.close()
        return jsonify({"vendedores": [{"id": v["id"], "nombre": v["nombre"]} for v in vendedores]})

    elif request.method == "POST":
        # Agregar nuevo vendedor
        body = request.json or {}
        nombre = body.get("nombre", "").strip()
        if not nombre:
            conn.close()
            return jsonify({"error": "Falta el nombre del vendedor"}), 400
        
        try:
            cursor = conn.execute("INSERT INTO vendedores (nombre) VALUES (?)", (nombre,))
            conn.commit()
            nuevo_id = cursor.lastrowid
            conn.close()
            return jsonify({"ok": True, "id": nuevo_id, "nombre": nombre})
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({"error": "El vendedor ya existe"}), 400

    elif request.method == "DELETE":
        # Eliminar vendedor
        body = request.json or {}
        vendedor_id = body.get("id")
        if not vendedor_id:
            conn.close()
            return jsonify({"error": "Falta el ID del vendedor"}), 400
        
        conn.execute("DELETE FROM vendedores WHERE id = ?", (vendedor_id,))
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "mensaje": "Vendedor eliminado"})

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

