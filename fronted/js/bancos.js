// ============ CONFIGURACIÓN ============
const NOMBRE_HOJA = "bancos";
let bancos = [];             // Lista de bancos { id, nombre }
let bancoActivo = null;      // Nombre del banco seleccionado
let movimientos = {};        // { nombreBanco: [movimientos] }
let tabActiva = "completo"; // 'completo' o 'sinIdentificar'
let movimientoIdentificando = null; // { mov, nombreBanco, nuevoValor, celda }
let bancoBorrando = null;    // id del banco a borrar

// ============ INICIALIZACIÓN ============
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btnAgregarBanco").addEventListener("click", abrirModalBanco);
    document.getElementById("btnCancelarBanco").addEventListener("click", cerrarModalBanco);
    document.getElementById("btnGuardarBanco").addEventListener("click", guardarBanco);
    document.getElementById("nombreBanco").addEventListener("keydown", (e) => {
        if (e.key === "Enter") guardarBanco();
    });

    document.getElementById("btnCancelarBorrarBanco").addEventListener("click", cerrarModalBorrarBanco);
    document.getElementById("btnConfirmarBorrarBanco").addEventListener("click", confirmarBorrarBanco);

    // Input de archivo Excel/CSV
    const inputExcel = document.getElementById("inputExcel");
    inputExcel.addEventListener("change", (e) => {
        const archivo = e.target.files[0];
        if (archivo && bancoActivo) {
            importarArchivo(archivo, bancoActivo);
        }
    });

    // Pestañas internas
    document.querySelectorAll(".tab-interna").forEach(btn => {
        btn.addEventListener("click", () => {
            tabActiva = btn.dataset.tab;
            document.querySelectorAll(".tab-interna").forEach(b => b.classList.remove("activa"));
            btn.classList.add("activa");
            if (bancoActivo) renderizarContenidoBanco(bancoActivo);
        });
    });

    // Modal identificación
    document.getElementById("btnCancelarIdentificar").addEventListener("click", cerrarModalIdentificar);
    document.getElementById("btnConfirmarIdentificar").addEventListener("click", confirmarIdentificar);
    document.getElementById("modalIdentificarFondo").addEventListener("click", (e) => {
        if (e.target.id === "modalIdentificarFondo") cerrarModalIdentificar();
    });
    document.getElementById("inputMotivoIdentificar").addEventListener("keydown", (e) => {
        if (e.key === "Enter") confirmarIdentificar();
    });

    document.getElementById("modalBancoFondo").addEventListener("click", (e) => {
        if (e.target.id === "modalBancoFondo") cerrarModalBanco();
    });
    document.getElementById("modalBorrarBancoFondo").addEventListener("click", (e) => {
        if (e.target.id === "modalBorrarBancoFondo") cerrarModalBorrarBanco();
    });

    cargarBancos();
});

// ============ CARGAR BANCOS ============
async function cargarBancos() {
    try {
        const respuesta = await fetch("/bancos");
        const data = await respuesta.json();
        bancos = data.bancos || [];
        renderizarTabs();
        if (bancos.length > 0) {
            const primero = bancos[0].nombre;
            if (!bancoActivo || !bancos.find(b => b.nombre === bancoActivo)) {
                bancoActivo = primero;
            }
            document.getElementById("tabsInternas").style.display = "flex";
            await seleccionarBanco(bancoActivo);
        } else {
            bancoActivo = null;
            document.getElementById("tabsInternas").style.display = "none";
            document.getElementById("contenidoBancos").innerHTML = `
                <p class="sin-datos" id="mensajeInicial">
                    No hay bancos creados localmente.<br>
                    Haz clic en "Agregar Banco" para empezar.
                </p>`;
        }
    } catch (error) {
        console.error("Error al cargar bancos:", error);
        document.getElementById("contenidoBancos").innerHTML = `<p class="sin-datos">Error al cargar bancos</p>`;
    }
}

// ============ RENDERIZAR PESTAÑAS DE BANCOS ============
function renderizarTabs() {
    const tabs = document.getElementById("tabsBancos");
    tabs.innerHTML = "";

    bancos.forEach(b => {
        const tab = document.createElement("div");
        tab.className = "tab-banco";
        if (b.nombre === bancoActivo) tab.classList.add("activa");
        tab.innerHTML = `
            <span class="tab-nombre">${escaparHtml(b.nombre)}</span>
            <button class="btn-eliminar-tab" title="Eliminar banco">×</button>
        `;

        tab.addEventListener("click", (e) => {
            if (e.target.closest(".btn-eliminar-tab")) return;
            seleccionarBanco(b.nombre);
        });
        tab.querySelector(".btn-eliminar-tab").addEventListener("click", (e) => {
            e.stopPropagation();
            abrirModalBorrarBanco(b);
        });

        tabs.appendChild(tab);
    });
}

// ============ SELECCIONAR BANCO ============
async function seleccionarBanco(nombre) {
    bancoActivo = nombre;
    renderizarTabs();
    await cargarMovimientos(nombre);
    renderizarContenidoBanco(nombre);
}

// ============ CARGAR MOVIMIENTOS DE UN BANCO ============
async function cargarMovimientos(nombre) {
    try {
        const respuesta = await fetch(`/bancos/${encodeURIComponent(nombre)}/movimientos`);
        const data = await respuesta.json();
        movimientos[nombre] = data.datos || [];
    } catch (error) {
        console.error(`Error al cargar movimientos de ${nombre}:`, error);
        movimientos[nombre] = [];
    }
}

// ============ RENDERIZAR CONTENIDO DEL BANCO ============
function renderizarContenidoBanco(nombre) {
    const contenedor = document.getElementById("contenidoBancos");
    const todos = movimientos[nombre] || [];
    const bancoInfo = bancos.find(b => b.nombre === nombre) || {};
    const bancoActual = parseInt(bancoInfo.banco_actual) || 0;

    const sinIdentificar = todos.filter(m => String(m["Identificación"] || "").trim() === "");
    const listaMostrar = tabActiva === "completo" ? todos : sinIdentificar;
    const totalBanco = todos.reduce((sum, m) => sum + (parseInt(m.Monto) || 0), 0);
    const diferencia = totalBanco - bancoActual;

    let resumenHTML = "";
    if (tabActiva === "completo") {
        resumenHTML = `
            <div class="resumen-tres-tarjetas">
                <div class="resumen-tarjeta">
                    <div class="resumen-label">Total en banco</div>
                    <div class="resumen-valor">$${formatearMonto(totalBanco)}</div>
                </div>
                <div class="resumen-tarjeta editable-banco-actual" title="Haz clic para editar">
                    <div class="resumen-label">Banco actual</div>
                    <div class="resumen-valor" id="valorBancoActual">$${formatearMonto(bancoActual)}</div>
                </div>
                <div class="resumen-tarjeta ${diferencia >= 0 ? 'positivo' : 'negativo'}">
                    <div class="resumen-label">Diferencia</div>
                    <div class="resumen-valor">$${formatearMonto(diferencia)}</div>
                </div>
            </div>
        `;
    } else {
        const totalSinIdentificar = sinIdentificar.reduce((sum, m) => sum + (parseInt(m.Monto) || 0), 0);
        resumenHTML = `
            <div class="total-card">
                <h2>${escaparHtml(nombre)} — Sin identificar</h2>
                <div class="total-monto">$${formatearMonto(totalSinIdentificar)}</div>
                <div class="total-detalle">Total banco: $${formatearMonto(totalBanco)} · Sin identificar: ${sinIdentificar.length} movimientos</div>
            </div>
        `;
    }

    contenedor.innerHTML = `
        ${resumenHTML}

        <div class="tabla-card">
            <h2>Movimientos</h2>
            <div class="tabla-scroll">
                <table>
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Descripción</th>
                            <th>Monto</th>
                            <th>Identificación</th>
                            <th width="60"></th>
                        </tr>
                    </thead>
                    <tbody id="tablaMovimientos">
                        ${listaMostrar.length === 0 ? `<tr><td colspan="5" class="sin-datos">No hay movimientos en esta pestaña</td></tr>` : ""}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    if (tabActiva === "completo") {
        const tarjetaBancoActual = contenedor.querySelector(".editable-banco-actual");
        if (tarjetaBancoActual) {
            tarjetaBancoActual.addEventListener("click", () => {
                iniciarEdicionBancoActual(nombre, bancoActual);
            });
        }
    }

    if (listaMostrar.length > 0) {
        const tbody = document.getElementById("tablaMovimientos");
        tbody.innerHTML = "";
        // Fecha más nueva arriba, más vieja abajo
        const listaOrdenada = [...listaMostrar].sort((a, b) => {
            const fa = new Date(a.Fecha + "T00:00:00");
            const fb = new Date(b.Fecha + "T00:00:00");
            return fb - fa;
        });
        listaOrdenada.forEach(mov => {
            const montoNum = parseInt(mov.Monto) || 0;
            const claseMonto = montoNum < 0 ? "monto-negativo" : "";
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escaparHtml(mov.Fecha)}</td>
                <td>${escaparHtml(mov["Descripción"])}</td>
                <td class="${claseMonto}">$${formatearMonto(mov.Monto)}</td>
                <td class="editable editable-identificacion" title="Haz clic para identificar">${escaparHtml(mov["Identificación"])}</td>
                <td class="col-menu"></td>
            `;

            const celdaIdent = tr.querySelector(".editable-identificacion");
            celdaIdent.addEventListener("click", () => {
                iniciarEdicionIdentificacion(mov, nombre, celdaIdent);
            });

            tr.querySelector(".col-menu").appendChild(crearMenuOpcionesBanco(mov, nombre));
            tbody.appendChild(tr);
        });
    }
}

function sumarMonto(lista) {
    return lista.reduce((sum, m) => sum + (parseInt(m.Monto) || 0), 0);
}

// ============ EDITAR BANCO ACTUAL ============
function iniciarEdicionBancoActual(nombreBanco, valorActual) {
    const div = document.getElementById("valorBancoActual");
    if (!div || div.querySelector("input")) return;

    const input = document.createElement("input");
    input.type = "number";
    input.value = valorActual;
    input.className = "input-en-linea input-banco-actual";

    div.innerHTML = "";
    div.appendChild(input);
    input.focus();
    input.select();

    async function guardar() {
        const nuevoValor = parseInt(input.value) || 0;
        div.innerHTML = `$${formatearMonto(nuevoValor)}`;
        if (nuevoValor !== valorActual) {
            await guardarBancoActual(nombreBanco, nuevoValor);
        }
    }

    input.addEventListener("blur", () => setTimeout(guardar, 100));
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            input.blur();
        } else if (e.key === "Escape") {
            div.innerHTML = `$${formatearMonto(valorActual)}`;
        }
    });
}

async function guardarBancoActual(nombreBanco, nuevoValor) {
    try {
        const respuesta = await fetch(`/bancos/${encodeURIComponent(nombreBanco)}/banco_actual`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ banco_actual: nuevoValor })
        });
        const resultado = await respuesta.json();
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        // Actualizar valor local
        const banco = bancos.find(b => b.nombre === nombreBanco);
        if (banco) banco.banco_actual = nuevoValor;
        renderizarContenidoBanco(nombreBanco);
    } catch (error) {
        console.error("Error al guardar banco actual:", error);
        alert("Error al guardar banco actual");
    }
}

// ============ IMPORTAR EXCEL/CSV ============
async function importarArchivo(archivo, nombreBanco) {
    if (!confirm(`¿Importar ${archivo.name} a ${nombreBanco}?`)) {
        document.getElementById("inputExcel").value = "";
        return;
    }

    const btnLabel = document.querySelector("label[for='inputExcel']");
    const textoOriginal = btnLabel.textContent;
    btnLabel.textContent = "⏳ Importando...";

    const formData = new FormData();
    formData.append("archivo", archivo);

    try {
        const respuesta = await fetch(`/bancos/${encodeURIComponent(nombreBanco)}/importar`, {
            method: "POST",
            body: formData
        });
        const resultado = await respuesta.json();
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        alert(`${resultado.insertados} movimientos importados y sincronizados`);
        await cargarMovimientos(nombreBanco);
        renderizarContenidoBanco(nombreBanco);
    } catch (error) {
        console.error("Error al importar:", error);
        alert("Error al importar el archivo");
    } finally {
        document.getElementById("inputExcel").value = "";
        btnLabel.textContent = textoOriginal;
    }
}

// ============ EDICIÓN EN CALIENTE DE IDENTIFICACIÓN ============
function iniciarEdicionIdentificacion(mov, nombreBanco, celda) {
    if (movimientoIdentificando) return;

    const valorActual = String(mov["Identificación"] || "").trim();
    const input = document.createElement("input");
    input.type = "text";
    input.value = valorActual;
    input.className = "input-en-linea";

    celda.innerHTML = "";
    celda.appendChild(input);
    input.focus();
    input.select();

    function guardar() {
        const nuevoValor = input.value.trim();
        celda.innerHTML = escaparHtml(nuevoValor);
        movimientoIdentificando = null;

        if (nuevoValor === valorActual) return;

        if (nuevoValor === "") {
            // Se está quitando la identificación, guardar directo
            guardarIdentificacion(mov, nombreBanco, "");
        } else {
            // Abrir modal de confirmación
            abrirModalIdentificar(mov, nombreBanco, nuevoValor, celda);
        }
    }

    input.addEventListener("blur", () => {
        setTimeout(guardar, 100);
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            input.blur();
        } else if (e.key === "Escape") {
            celda.innerHTML = escaparHtml(valorActual);
            movimientoIdentificando = null;
        }
    });

    movimientoIdentificando = { mov, nombreBanco, celda };
}

async function guardarIdentificacion(mov, nombreBanco, nuevoValor) {
    const datos = {
        Fecha: mov.Fecha,
        Descripción: mov["Descripción"],
        Monto: mov.Monto,
        Identificación: nuevoValor
    };

    try {
        const respuesta = await fetch(`/bancos/${encodeURIComponent(nombreBanco)}/movimientos/${mov.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ datos })
        });
        const resultado = await respuesta.json();
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        await cargarMovimientos(nombreBanco);
        renderizarContenidoBanco(nombreBanco);

        // Sincronizar automáticamente
        await sincronizarSilenciosa();
    } catch (error) {
        console.error("Error al guardar identificación:", error);
        alert("Error al guardar identificación");
    }
}

// ============ MODAL IDENTIFICAR ============
function abrirModalIdentificar(mov, nombreBanco, nuevoValor, celda) {
    movimientoIdentificando = { mov, nombreBanco, nuevoValor, celda };
    document.getElementById("textoIdentificar").innerHTML =
        `Ojo se va a identificar <strong>$${formatearMonto(mov.Monto)}</strong> por:`;
    document.getElementById("inputMotivoIdentificar").value = nuevoValor;
    document.getElementById("modalIdentificarFondo").classList.add("abierto");
    setTimeout(() => document.getElementById("inputMotivoIdentificar").focus(), 100);
}

function cerrarModalIdentificar() {
    movimientoIdentificando = null;
    document.getElementById("modalIdentificarFondo").classList.remove("abierto");
    if (bancoActivo) renderizarContenidoBanco(bancoActivo);
}

async function confirmarIdentificar() {
    if (!movimientoIdentificando) return;
    const { mov, nombreBanco, celda } = movimientoIdentificando;
    const motivo = document.getElementById("inputMotivoIdentificar").value.trim();
    if (!motivo) {
        alert("Escribe el motivo de identificación");
        return;
    }

    document.getElementById("btnConfirmarIdentificar").textContent = "⏳";
    await guardarIdentificacion(mov, nombreBanco, motivo);
    document.getElementById("btnConfirmarIdentificar").textContent = "Guardar";
    cerrarModalIdentificar();
}

// ============ MENÚ DE OPCIONES POR MOVIMIENTO ============
function crearMenuOpcionesBanco(mov, nombreBanco) {
    const contenedor = document.createElement("div");
    contenedor.className = "menu-opciones";
    contenedor.innerHTML = `
        <button class="btn-opciones" title="Opciones">⋮</button>
        <div class="dropdown-opciones">
            <button class="opcion-borrar">🗑️ Borrar</button>
        </div>
    `;

    const btnOpciones = contenedor.querySelector(".btn-opciones");
    const dropdown = contenedor.querySelector(".dropdown-opciones");

    btnOpciones.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".dropdown-opciones.abierto").forEach(d => {
            if (d !== dropdown) d.classList.remove("abierto");
        });
        dropdown.classList.toggle("abierto");
    });

    contenedor.querySelector(".opcion-borrar").addEventListener("click", () => {
        dropdown.classList.remove("abierto");
        borrarMovimiento(mov, nombreBanco);
    });

    return contenedor;
}

// ============ MODAL BANCO ============
function abrirModalBanco() {
    document.getElementById("nombreBanco").value = "";
    document.getElementById("tituloModalBanco").textContent = "Agregar Banco";
    document.getElementById("modalBancoFondo").classList.add("abierto");
    setTimeout(() => document.getElementById("nombreBanco").focus(), 100);
}

function cerrarModalBanco() {
    document.getElementById("modalBancoFondo").classList.remove("abierto");
}

async function guardarBanco() {
    let nombre = document.getElementById("nombreBanco").value.trim();
    if (!nombre) {
        alert("Escribe un nombre para el banco");
        return;
    }
    if (!nombre.toLowerCase().startsWith("banco_")) {
        nombre = "banco_" + nombre;
    }

    try {
        const respuesta = await fetch("/bancos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre })
        });
        const resultado = await respuesta.json();
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        cerrarModalBanco();
        await cargarBancos();
        seleccionarBanco(nombre);
    } catch (error) {
        console.error("Error al guardar banco:", error);
        alert("Error al guardar banco");
    }
}

// ============ MODAL BORRAR BANCO ============
function abrirModalBorrarBanco(banco) {
    bancoBorrando = banco;
    document.getElementById("nombreBancoBorrar").textContent = escaparHtml(banco.nombre);
    document.getElementById("textoVerificarBorrar").textContent = escaparHtml(banco.nombre);
    const input = document.getElementById("inputVerificarBorrarBanco");
    input.value = "";
    input.dataset.nombre = banco.nombre;
    input.addEventListener("input", actualizarBotonBorrarBanco);
    document.getElementById("btnConfirmarBorrarBanco").disabled = true;
    document.getElementById("modalBorrarBancoFondo").classList.add("abierto");
    setTimeout(() => input.focus(), 100);
}

function actualizarBotonBorrarBanco(e) {
    const input = e.target;
    const nombreEsperado = input.dataset.nombre || "";
    const coincide = input.value.trim().toLowerCase() === nombreEsperado.toLowerCase();
    document.getElementById("btnConfirmarBorrarBanco").disabled = !coincide;
}

function cerrarModalBorrarBanco() {
    bancoBorrando = null;
    document.getElementById("modalBorrarBancoFondo").classList.remove("abierto");
}

async function confirmarBorrarBanco() {
    if (!bancoBorrando) return;
    const input = document.getElementById("inputVerificarBorrarBanco");
    if (input.value.trim().toLowerCase() !== bancoBorrando.nombre.toLowerCase()) {
        alert("El nombre no coincide. Escribe exactamente el nombre del banco.");
        return;
    }
    try {
        const respuesta = await fetch("/bancos", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: bancoBorrando.id })
        });
        const resultado = await respuesta.json();
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        cerrarModalBorrarBanco();
        await cargarBancos();
        if (bancos.length > 0) {
            seleccionarBanco(bancos[0].nombre);
        }
    } catch (error) {
        console.error("Error al borrar banco:", error);
        alert("Error al borrar banco");
    }
}

// ============ BORRAR MOVIMIENTO ============
async function borrarMovimiento(mov, nombreBanco) {
    if (!confirm("¿Eliminar este movimiento?")) return;
    try {
        const respuesta = await fetch(`/bancos/${encodeURIComponent(nombreBanco)}/movimientos/${mov.id}`, {
            method: "DELETE"
        });
        const resultado = await respuesta.json();
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        await cargarMovimientos(nombreBanco);
        renderizarContenidoBanco(nombreBanco);
        await sincronizarSilenciosa();
    } catch (error) {
        console.error("Error al borrar movimiento:", error);
        alert("Error al borrar movimiento");
    }
}

// ============ SINCRONIZACIÓN ============
async function sincronizarSilenciosa() {
    try {
        await fetch("/sincronizar", { method: "POST" });
    } catch (e) {
        console.error("Error en sincronización silenciosa:", e);
    }
}

async function cargarMovimientosGlobales() {
    if (bancoActivo && bancos.find(b => b.nombre === bancoActivo)) {
        await cargarMovimientos(bancoActivo);
        renderizarContenidoBanco(bancoActivo);
    }
}

async function sincronizarEspecial() {
    const btnSync = document.getElementById("btnSync");
    btnSync.disabled = true;
    btnSync.textContent = "⏳";

    try {
        await fetch("/bancos/detectar", { method: "POST" });
        const respSync = await fetch("/sincronizar", { method: "POST" });
        const resSync = await respSync.json();
        await cargarBancos();
        btnSync.textContent = resSync.pendientes === 0 ? "✅" : `⚠️ ${resSync.pendientes}`;
    } catch (error) {
        console.error("[SYNC BANCOS] Error:", error);
        btnSync.textContent = "❌";
    }

    setTimeout(() => {
        btnSync.disabled = false;
        btnSync.textContent = "🔄 Sync";
    }, 2000);
}

// ============ AUXILIARES ============
function formatearMonto(valor) {
    const numero = parseInt(valor) || 0;
    return numero.toLocaleString("es-CO");
}

function escaparHtml(texto) {
    if (texto === null || texto === undefined) return "";
    return String(texto)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
