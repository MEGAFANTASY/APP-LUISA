/*************************************************
 * APP LUISA - API con Google Apps Script
 * 
 * Esta API conecta el frontend con Google Sheets.
 * 
 * ESTRUCTURA DE CADA HOJA:
 *   Columna A: Fecha
 *   Columna B: Tipo (Ingreso / Gasto)
 *   Columna C: Descripción
 *   Columna D: Monto
 *   Columna E: ID  ← identificador del registro en SQLite
 * 
 * La primera fila debe ser el encabezado.
 * 
 * ACCIONES (parámetro "accion" en el body del POST):
 *   - "nuevo" o "actualizar": crea la fila si el ID no existe,
 *      o actualiza la fila que tenga ese ID
 *   - "borrar": elimina la fila que tenga ese ID
 *************************************************/

const SPREADSHEET_ID = "PEGA_AQUI_EL_ID_DE_TU_HOJA"; // ⚠️ Reemplazar con tu ID

// Encabezados de columnas para cada bloque de banco
const COLUMNAS_BANCO = ["Fecha", "Descripción", "Monto", "Identificación", "Id"];

// ============ LEER DATOS (GET) ============
// Uso:  URL?hoja=CajaMenor
function doGet(e) {
  const nombreHoja = e.parameter.hoja || "CajaMenor";
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const hoja = ss.getSheetByName(nombreHoja);

  if (!hoja) {
    return responderJSON({ error: "La hoja '" + nombreHoja + "' no existe" });
  }

  // Si es la hoja de bancos, devolver los bloques de cada banco por separado
  if (nombreHoja.toLowerCase() === "bancos") {
    const bloques = obtenerBloquesBancos(hoja);
    return responderJSON({ bancos: bloques });
  }

  const datos = hoja.getDataRange().getValues();
  const encabezados = datos[0];
  const filas = datos.slice(1);

  // Convertir a array de objetos
  const resultado = filas.map(fila => {
    const objeto = {};
    encabezados.forEach((encabezado, i) => {
      objeto[encabezado] = fila[i];
    });
    return objeto;
  });

  return responderJSON({ datos: resultado });
}

// ============ GUARDAR / ACTUALIZAR / BORRAR (POST) ============
// Body normal: { hoja, accion, id, datos: { Fecha, Tipo, Descripción, Monto } }
// Body bancos: { hoja:"bancos", accion, banco:"banco_flor", id:"banco_flor_1", datos: { Fecha, Descripción, Monto, Identificación } }
function doPost(e) {
  try {
    logDebug("doPost iniciado. postData: " + JSON.stringify(e.postData));

    let body;
    if (e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
        logDebug("Parseado postData.contents como JSON");
      } catch (parseErr) {
        logDebug("FALLÓ parse JSON. Tipo: " + (e.postData.type || "N/A") + " | Contenido: " + e.postData.contents);
        body = e.parameter || {};
      }
    } else if (e.postData && e.postData.type === "application/json") {
      body = JSON.parse(e.parameter);
    } else {
      logDebug("No había postData. Params: " + JSON.stringify(e.parameter || {}));
      body = e.parameter || {};
    }

    const nombreHoja = body.hoja || "CajaMenor";
    const accion = body.accion || "nuevo";
    const id = String(body.id || "");
    const datos = body.datos || {};

    logDebug("Parsed body: hoja=" + nombreHoja + " accion=" + accion + " id=" + id);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let hoja = ss.getSheetByName(nombreHoja);

    if (!hoja) {
      return responderJSON({ error: "La hoja '" + nombreHoja + "' no existe" });
    }

    // Si es la hoja de bancos, usar lógica especial de bloques
    if (nombreHoja.toLowerCase() === "bancos") {
      const nombreBanco = body.banco || "";
      if (!nombreBanco) {
        return responderJSON({ error: "Falta el nombre del banco (campo 'banco')" });
      }
      return manejarBanco(hoja, nombreBanco, accion, id, datos);
    }

    // Lógica estándar para otras hojas
    const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    let indiceId = indiceColumnaId(encabezados);

    if (indiceId === -1) {
      hoja.getRange(1, encabezados.length + 1).setValue("Id");
      encabezados.push("Id");
      indiceId = encabezados.length - 1;
      logDebug("La columna 'Id' no existía en " + nombreHoja + ". Se creó en la columna " + (indiceId + 1));
    }

    const filaExistente = buscarFilaPorId(hoja, id, indiceId);
    logDebug("buscarFilaPorId(" + id + ") => fila " + filaExistente);

    if (accion === "borrar") {
      if (filaExistente > 0) {
        hoja.deleteRow(filaExistente);
        logDebug("Borrado fila " + filaExistente + " id=" + id);
        return responderJSON({ ok: true, mensaje: "Registro borrado" });
      }
      logDebug("Nada que borrar id=" + id + ". IDs en hoja: " + listarIds(hoja, indiceId));
      return responderJSON({ ok: true, mensaje: "Nada que borrar" });
    }

    if (filaExistente > 0) {
      encabezados.forEach((encabezado, i) => {
        if (i === indiceId) {
          hoja.getRange(filaExistente, i + 1).setValue(id);
        } else if (datos[encabezado] !== undefined) {
          hoja.getRange(filaExistente, i + 1).setValue(datos[encabezado]);
        }
      });
      return responderJSON({ ok: true, mensaje: "Registro actualizado" });
    }

    const nuevaFila = encabezados.map((encabezado, i) => {
      if (i === indiceId) return id;
      return datos[encabezado] || "";
    });
    hoja.appendRow(nuevaFila);

    return responderJSON({ ok: true, mensaje: "Registro guardado correctamente" });

  } catch (error) {
    logDebug("ERROR doPost: " + error.message);
    return responderJSON({ error: error.message });
  }
}

// ============ LÓGICA ESPECIAL PARA HOJA "bancos" ============
function manejarBanco(hoja, nombreBanco, accion, id, datos) {
  const bloque = obtenerOcrearBloqueBanco(hoja, nombreBanco);

  if (accion === "asegurar_banco") {
    return responderJSON({ ok: true, mensaje: "Bloque asegurado" });
  }

  const filaExistente = buscarFilaPorId(hoja, id, bloque.colId);

  if (accion === "borrar") {
    if (filaExistente > 0) {
      hoja.deleteRow(filaExistente);
      logDebug("Borrado fila " + filaExistente + " id=" + id + " banco=" + nombreBanco);
      return responderJSON({ ok: true, mensaje: "Registro borrado" });
    }
    return responderJSON({ ok: true, mensaje: "Nada que borrar" });
  }

  const valores = COLUMNAS_BANCO.map((col, i) => {
    if (col === "Id") return id;
    return datos[col] || "";
  });

  if (filaExistente > 0) {
    for (let i = 0; i < COLUMNAS_BANCO.length; i++) {
      hoja.getRange(filaExistente, bloque.colInicio + i + 1).setValue(valores[i]);
    }
    return responderJSON({ ok: true, mensaje: "Registro actualizado" });
  }

  // Encontrar primera fila libre en el bloque
  const ultimaFila = hoja.getLastRow();
  let filaDestino = 3; // fila 1 = nombre banco, fila 2 = encabezados
  for (let f = 3; f <= ultimaFila + 1; f++) {
    const celdaId = hoja.getRange(f, bloque.colId + 1).getValue();
    if (!celdaId || String(celdaId).trim() === "") {
      filaDestino = f;
      break;
    }
  }

  for (let i = 0; i < COLUMNAS_BANCO.length; i++) {
    hoja.getRange(filaDestino, bloque.colInicio + i + 1).setValue(valores[i]);
  }

  return responderJSON({ ok: true, mensaje: "Registro guardado correctamente" });
}

// Busca un bloque existente o lo crea al final de la hoja
function obtenerOcrearBloqueBanco(hoja, nombreBanco) {
  const datos = hoja.getDataRange().getValues();
  const numCols = hoja.getLastColumn();

  // Buscar en fila 1 el nombre del banco
  for (let c = 0; c < numCols; c++) {
    const celda = datos[0][c];
    if (String(celda).trim().toLowerCase() === nombreBanco.trim().toLowerCase()) {
      return {
        colInicio: c,
        colId: c + 4 // Fecha, Descripción, Monto, Identificación, Id
      };
    }
  }

  // No existe: crear nuevo bloque al final
  const nuevaCol = numCols > 0 ? numCols + 1 : 1; // dejar espacio si ya hay columnas
  const colFinal = numCols === 0 ? 1 : numCols + 2;

  // Nombre del banco (fila 1, unido 4 celdas)
  hoja.getRange(1, colFinal, 1, 4).merge().setValue(nombreBanco).setFontWeight("bold").setHorizontalAlignment("center");
  // Encabezados
  for (let i = 0; i < 4; i++) {
    hoja.getRange(2, colFinal + i).setValue(COLUMNAS_BANCO[i]).setFontWeight("bold");
  }

  return {
    colInicio: colFinal - 1,
    colId: colFinal - 1 + 4
  };
}

// Lee todos los bloques de bancos de la hoja
function obtenerBloquesBancos(hoja) {
  const datos = hoja.getDataRange().getValues();
  const numCols = hoja.getLastColumn();
  const bloques = [];

  for (let c = 0; c < numCols; c++) {
    const nombre = String(datos[0][c] || "").trim();
    if (nombre.toLowerCase().startsWith("banco_")) {
      const encabezados = [];
      for (let i = 0; i < 4; i++) encabezados.push(datos[1][c + i]);
      const filas = [];
      for (let f = 2; f < datos.length; f++) {
        const fila = {};
        for (let i = 0; i < 4; i++) {
          fila[encabezados[i]] = datos[f][c + i];
        }
        fila["Id"] = datos[f][c + 4];
        filas.push(fila);
      }
      bloques.push({ nombre: nombre, encabezados: encabezados, datos: filas });
      c += 4; // saltar separación
    }
  }
  return bloques;
}

// ============ LOG DE DEPURACIÓN ============
function logDebug(mensaje) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let hojaLog = ss.getSheetByName("Logs");
    if (!hojaLog) {
      hojaLog = ss.insertSheet("Logs");
      hojaLog.appendRow(["Fecha", "Mensaje"]);
    }
    hojaLog.appendRow([new Date(), mensaje]);
  } catch (e) {
    // Si no puede logear, ignora
  }
}

// ============ BUSCAR COLUMNA ID ============
// Encuentra el índice de la columna cuyo encabezado sea "id" sin importar mayúsculas.
// Si no existe, devuelve -1 (el doPost se encarga de crearla al final).
function indiceColumnaId(encabezados) {
  for (let i = 0; i < encabezados.length; i++) {
    if (String(encabezados[i]).trim().toLowerCase() === "id") return i;
  }
  return -1;
}

// ============ BUSCAR FILA POR ID ============
// Busca el ID en la columna ID indicada. Devuelve el número de fila o 0 si no existe.
function buscarFilaPorId(hoja, id, indiceColumnaId) {
  if (!id || indiceColumnaId === null || indiceColumnaId < 0) return 0;
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return 0; // solo encabezados

  const columnaId = hoja.getRange(2, indiceColumnaId + 1, ultimaFila - 1, 1).getValues();
  for (let i = 0; i < columnaId.length; i++) {
    if (String(columnaId[i][0]).trim() === id.trim()) {
      return i + 2; // +2: fila 1 es encabezado, índice base 1
    }
  }
  return 0;
}

// ============ LISTAR IDs (para depurar) ============
function listarIds(hoja, indiceColumnaId) {
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return "(hoja sin datos)";
  const valores = hoja.getRange(2, indiceColumnaId + 1, ultimaFila - 1, 1).getValues();
  return "[" + valores.map(v => "'" + String(v[0]) + "'").join(", ") + "]";
}

// ============ FUNCIÓN AUXILIAR ============
function responderJSON(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
