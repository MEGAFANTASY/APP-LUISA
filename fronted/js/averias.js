// ============ CONFIGURACIÓN ============
const NOMBRE_HOJA = "averias";
let averias = []; // Todas las averías cargadas
let vendedores = []; // Lista de vendedores disponibles
let averiaEditando = null; // Avería que se está editando (null = nueva)
let mostrarCompletadas = false; // Toggle para ver averías completadas

// ============ CARGAR DATOS AL ABRIR LA PÁGINA ============
document.addEventListener("DOMContentLoaded", () => {
    cargarVendedores();
    cargarAverias();
    
    // Event listeners
    document.getElementById("btnNuevaAveria").addEventListener("click", abrirModalNuevaAveria);
    document.getElementById("btnGestionarVendedores").addEventListener("click", abrirModalVendedores);
    document.getElementById("filtroVendedor").addEventListener("change", filtrarPorVendedor);
    document.getElementById("chkMostrarCompletadas").addEventListener("change", toggleMostrarCompletadas);
    
    // Modal avería
    document.getElementById("formAveria").addEventListener("submit", guardarAveria);
    document.getElementById("btnCancelarAveria").addEventListener("click", cerrarModalAveria);
    document.getElementById("modalAveriaFondo").addEventListener("click", (e) => {
        if (e.target.id === "modalAveriaFondo") cerrarModalAveria();
    });
    
    // Modal vendedores
    document.getElementById("btnAgregarVendedor").addEventListener("click", agregarVendedor);
    document.getElementById("btnCerrarVendedores").addEventListener("click", cerrarModalVendedores);
    document.getElementById("modalVendedoresFondo").addEventListener("click", (e) => {
        if (e.target.id === "modalVendedoresFondo") cerrarModalVendedores();
    });
    
    // Modal borrar
    document.getElementById("btnCancelarBorrar").addEventListener("click", cerrarModalBorrar);
    document.getElementById("btnConfirmarBorrar").addEventListener("click", confirmarBorrarAveria);
    document.getElementById("modalBorrarFondo").addEventListener("click", (e) => {
        if (e.target.id === "modalBorrarFondo") cerrarModalBorrar();
    });
});

// ============ CARGAR VENDEDORES ============
async function cargarVendedores() {
    try {
        const respuesta = await fetch("/vendedores");
        const data = await respuesta.json();
        vendedores = data.vendedores || [];
        
        // Llenar dropdown del formulario
        const selectVendedor = document.getElementById("averiaVendedor");
        selectVendedor.innerHTML = '<option value="">Seleccionar...</option>';
        vendedores.forEach(v => {
            const option = document.createElement("option");
            option.value = v.nombre;
            option.textContent = v.nombre;
            selectVendedor.appendChild(option);
        });
        
        // Llenar dropdown del filtro
        const selectFiltro = document.getElementById("filtroVendedor");
        selectFiltro.innerHTML = '<option value="">Todos</option>';
        vendedores.forEach(v => {
            const option = document.createElement("option");
            option.value = v.nombre;
            option.textContent = v.nombre;
            selectFiltro.appendChild(option);
        });
        
    } catch (error) {
        console.error("Error al cargar vendedores:", error);
    }
}

// ============ CARGAR AVERÍAS ============
async function cargarAverias() {
    const tbody = document.getElementById("tablaAverias");

    try {
        const respuesta = await fetch(`/leer?hoja=${NOMBRE_HOJA}`);
        const data = await respuesta.json();

        if (data.error) {
            tbody.innerHTML = `<tr><td colspan="12" class="sin-datos">Error: ${data.error}</td></tr>`;
            return;
        }

        averias = data.datos || [];
        mostrarAverias(averias);

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="12" class="sin-datos">Error al cargar datos</td></tr>`;
        console.error("Error:", error);
    }
}

// ============ MOSTRAR EN LA TABLA ============
function mostrarAverias(lista) {
    const tbody = document.getElementById("tablaAverias");

    // Filtrar según toggle de completadas
    let listaVisible;
    if (mostrarCompletadas) {
        // Mostrar SOLO las completadas (Enviada O Descontada) + Entregado
        listaVisible = lista.filter(a => {
            const statusBodegaCompleto = a["Status Bodega"] === "Enviada" || a["Status Bodega"] === "Descontada";
            const completada = statusBodegaCompleto && a["Status Averias"] === "Entregado";
            return completada;
        });
    } else {
        // Mostrar las NO completadas
        listaVisible = lista.filter(a => {
            const statusBodegaCompleto = a["Status Bodega"] === "Enviada" || a["Status Bodega"] === "Descontada";
            const completada = statusBodegaCompleto && a["Status Averias"] === "Entregado";
            return !completada;
        });
    }

    if (listaVisible.length === 0) {
        const mensaje = mostrarCompletadas ? "No hay averías completadas" : "No hay averías pendientes";
        tbody.innerHTML = `<tr><td colspan="11" class="sin-datos">${mensaje}</td></tr>`;
        return;
    }

    tbody.innerHTML = "";

    listaVisible.forEach(averia => {
        const fila = document.createElement("tr");
        
        fila.innerHTML = `
            <td>${formatearFecha(averia.Fecha)}</td>
            <td>${averia.Vendedor}</td>
            <td>${averia.Cliente}</td>
            <td>${averia.Ciudad}</td>
            <td>${averia.Direccion}</td>
            <td class="monto-valor">$${formatearMonto(averia.Valor)}</td>
            <td class="editable" data-campo="Status Bodega" data-id="${averia.id}">${averia["Status Bodega"]}</td>
            <td class="editable" data-campo="Status Averias" data-id="${averia.id}">${averia["Status Averias"]}</td>
            <td class="editable" data-campo="Fecha Envio" data-id="${averia.id}">${averia["Fecha Envio"] ? formatearFecha(averia["Fecha Envio"]) : "-"}</td>
            <td class="editable editable-textarea" data-campo="Observaciones" data-id="${averia.id}">${averia.Observaciones || "-"}</td>
        `;
        
        // Menú de opciones (⋮)
        const celdaOpciones = document.createElement("td");
        celdaOpciones.appendChild(crearMenuOpcionesAveria(averia));
        fila.appendChild(celdaOpciones);

        tbody.appendChild(fila);
    });
}

// ============ FILTRAR POR VENDEDOR ============
function filtrarPorVendedor() {
    const vendedorSeleccionado = document.getElementById("filtroVendedor").value;
    
    if (!vendedorSeleccionado) {
        mostrarAverias(averias); // Mostrar todas (según toggle)
    } else {
        const filtradas = averias.filter(a => a.Vendedor === vendedorSeleccionado);
        mostrarAverias(filtradas);
    }
}

// ============ TOGGLE MOSTRAR COMPLETADAS ============
function toggleMostrarCompletadas() {
    mostrarCompletadas = document.getElementById("chkMostrarCompletadas").checked;
    filtrarPorVendedor(); // Aplicar filtro de vendedor + toggle
}

// ============ MODAL NUEVA/EDITAR AVERÍA ============
function abrirModalNuevaAveria() {
    averiaEditando = null;
    document.getElementById("tituloModalAveria").textContent = "➕ Nueva Avería";
    document.getElementById("formAveria").reset();
    document.getElementById("modalAveriaFondo").classList.add("abierto");
}

function abrirModalEditarAveria(averia) {
    averiaEditando = averia;
    document.getElementById("tituloModalAveria").textContent = "✏️ Editar Avería";
    
    // Llenar formulario
    document.getElementById("averiaFecha").value = formatearFechaInput(averia.Fecha);
    document.getElementById("averiaVendedor").value = averia.Vendedor;
    document.getElementById("averiaCliente").value = averia.Cliente;
    document.getElementById("averiaCiudad").value = averia.Ciudad;
    document.getElementById("averiaDireccion").value = averia.Direccion;
    document.getElementById("averiaValor").value = averia.Valor;
    document.getElementById("averiaStatusBodega").value = averia["Status Bodega"];
    document.getElementById("averiaStatusAverias").value = averia["Status Averias"];
    document.getElementById("averiaFechaEnvio").value = averia["Fecha Envio"] ? formatearFechaInput(averia["Fecha Envio"]) : "";
    document.getElementById("averiaObservaciones").value = averia.Observaciones || "";
    
    document.getElementById("modalAveriaFondo").classList.add("abierto");
}

function cerrarModalAveria() {
    averiaEditando = null;
    document.getElementById("modalAveriaFondo").classList.remove("abierto");
}

// ============ GUARDAR AVERÍA ============
async function guardarAveria(e) {
    e.preventDefault();
    
    const datos = {
        "Fecha": document.getElementById("averiaFecha").value,
        "Vendedor": document.getElementById("averiaVendedor").value,
        "Cliente": document.getElementById("averiaCliente").value,
        "Ciudad": document.getElementById("averiaCiudad").value,
        "Direccion": document.getElementById("averiaDireccion").value,
        "Valor": document.getElementById("averiaValor").value,
        "Status Bodega": document.getElementById("averiaStatusBodega").value,
        "Status Averias": document.getElementById("averiaStatusAverias").value,
        "Fecha Envio": document.getElementById("averiaFechaEnvio").value || "",
        "Observaciones": document.getElementById("averiaObservaciones").value || ""
    };
    
    try {
        if (averiaEditando) {
            // EDITAR
            const respuesta = await fetch("/actualizar", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    hoja: NOMBRE_HOJA,
                    id: averiaEditando.id,
                    datos: datos
                })
            });
            const resultado = await respuesta.json();
            if (resultado.error) {
                alert("Error: " + resultado.error);
                return;
            }
        } else {
            // NUEVO
            const respuesta = await fetch("/guardar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    hoja: NOMBRE_HOJA,
                    datos: datos
                })
            });
            const resultado = await respuesta.json();
            if (resultado.error) {
                alert("Error: " + resultado.error);
                return;
            }
        }
        
        cerrarModalAveria();
        cargarAverias();
        
    } catch (error) {
        console.error("Error al guardar:", error);
        alert("Error al guardar la avería");
    }
}

// ============ MENÚ DE OPCIONES (⋮) ============
function crearMenuOpcionesAveria(averia) {
    const contenedor = document.createElement("div");
    contenedor.className = "menu-opciones";
    contenedor.innerHTML = `
        <button class="btn-opciones" title="Opciones">⋮</button>
        <div class="dropdown-opciones">
            <button class="opcion-editar">✏️ Editar</button>
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

    contenedor.querySelector(".opcion-editar").addEventListener("click", () => {
        dropdown.classList.remove("abierto");
        abrirModalEditarAveria(averia);
    });

    contenedor.querySelector(".opcion-borrar").addEventListener("click", () => {
        dropdown.classList.remove("abierto");
        abrirModalBorrarAveria(averia);
    });

    return contenedor;
}

// ============ MODAL BORRAR ============
let averiaBorrando = null;

function abrirModalBorrarAveria(averia) {
    averiaBorrando = averia;
    document.getElementById("borrarDescripcion").textContent = 
        `${averia.Cliente} - ${averia.Ciudad} ($${formatearMonto(averia.Valor)})`;
    document.getElementById("modalBorrarFondo").classList.add("abierto");
}

function cerrarModalBorrar() {
    averiaBorrando = null;
    document.getElementById("modalBorrarFondo").classList.remove("abierto");
}

async function confirmarBorrarAveria() {
    if (!averiaBorrando) return;
    
    try {
        const respuesta = await fetch("/borrar", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hoja: NOMBRE_HOJA, id: averiaBorrando.id })
        });
        const resultado = await respuesta.json();
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        cerrarModalBorrar();
        cargarAverias();
    } catch (error) {
        console.error("Error al borrar:", error);
        alert("Error al borrar la avería");
    }
}

// ============ MODAL GESTIONAR VENDEDORES ============
function abrirModalVendedores() {
    cargarListaVendedores();
    document.getElementById("modalVendedoresFondo").classList.add("abierto");
}

function cerrarModalVendedores() {
    document.getElementById("modalVendedoresFondo").classList.remove("abierto");
    document.getElementById("nuevoVendedor").value = "";
}

function cargarListaVendedores() {
    const contenedor = document.getElementById("listaVendedores");
    
    if (vendedores.length === 0) {
        contenedor.innerHTML = '<p class="sin-datos">No hay vendedores registrados</p>';
        return;
    }
    
    contenedor.innerHTML = "";
    vendedores.forEach(v => {
        const item = document.createElement("div");
        item.className = "vendedor-item";
        item.innerHTML = `
            <span class="nombre">${v.nombre}</span>
            <button class="btn-eliminar-vendedor" data-id="${v.id}">🗑️ Eliminar</button>
        `;
        
        item.querySelector(".btn-eliminar-vendedor").addEventListener("click", () => {
            eliminarVendedor(v.id, v.nombre);
        });
        
        contenedor.appendChild(item);
    });
}

async function agregarVendedor() {
    const input = document.getElementById("nuevoVendedor");
    const nombre = input.value.trim();
    
    if (!nombre) {
        alert("Escribe el nombre del vendedor");
        return;
    }
    
    try {
        const respuesta = await fetch("/vendedores", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre })
        });
        
        const resultado = await respuesta.json();
        
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        
        input.value = "";
        await cargarVendedores(); // Recargar dropdowns
        cargarListaVendedores(); // Recargar lista en modal
        
    } catch (error) {
        console.error("Error al agregar vendedor:", error);
        alert("Error al agregar vendedor");
    }
}

async function eliminarVendedor(id, nombre) {
    if (!confirm(`¿Eliminar al vendedor "${nombre}"?`)) return;
    
    try {
        const respuesta = await fetch("/vendedores", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        
        const resultado = await respuesta.json();
        
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        
        await cargarVendedores(); // Recargar dropdowns
        cargarListaVendedores(); // Recargar lista en modal
        
    } catch (error) {
        console.error("Error al eliminar vendedor:", error);
        alert("Error al eliminar vendedor");
    }
}

// ============ AUXILIARES ============
function formatearFecha(fecha) {
    if (!fecha) return "";
    const f = new Date(fecha);
    return f.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatearFechaInput(fecha) {
    if (!fecha) return "";
    const f = new Date(fecha);
    const yyyy = f.getFullYear();
    const mm = String(f.getMonth() + 1).padStart(2, "0");
    const dd = String(f.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function formatearMonto(monto) {
    const num = parseFloat(monto) || 0;
    return num.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ============ EDICIÓN EN CALIENTE ============
document.addEventListener("DOMContentLoaded", () => {
    // Delegación de eventos para celdas editables
    document.getElementById("tablaAverias").addEventListener("click", (e) => {
        const celda = e.target.closest(".editable");
        if (!celda || celda.querySelector("select, input, textarea")) return; // Ya está en modo edición
        
        activarEdicionEnCaliente(celda);
    });
});

function activarEdicionEnCaliente(celda) {
    const campo = celda.dataset.campo;
    const id = celda.dataset.id;
    const valorActual = celda.textContent.trim();
    
    if (campo === "Status Bodega") {
        // Dropdown para Status Bodega
        celda.innerHTML = `
            <select class="editing-select">
                <option value="Recibida" ${valorActual === "Recibida" ? "selected" : ""}>Recibida</option>
                <option value="Enviada" ${valorActual === "Enviada" ? "selected" : ""}>Enviada</option>
                <option value="Descontada" ${valorActual === "Descontada" ? "selected" : ""}>Descontada</option>
            </select>
        `;
        
        const select = celda.querySelector("select");
        select.focus();
        
        let guardado = false;
        
        select.addEventListener("change", async () => {
            guardado = true;
            await guardarEdicionCaliente(celda, id, campo, select.value);
        });
        
        select.addEventListener("blur", () => {
            if (!guardado) {
                restaurarCelda(celda, valorActual);
            }
        });
        
    } else if (campo === "Status Averias") {
        // Dropdown para Status Averías
        celda.innerHTML = `
            <select class="editing-select">
                <option value="Entregado" ${valorActual === "Entregado" ? "selected" : ""}>Entregado</option>
                <option value="Pendientes" ${valorActual === "Pendientes" ? "selected" : ""}>Pendientes</option>
            </select>
        `;
        
        const select = celda.querySelector("select");
        select.focus();
        
        let guardado = false;
        
        select.addEventListener("change", async () => {
            guardado = true;
            await guardarEdicionCaliente(celda, id, campo, select.value);
        });
        
        select.addEventListener("blur", () => {
            if (!guardado) {
                restaurarCelda(celda, valorActual);
            }
        });
        
    } else if (campo === "Observaciones") {
        // Textarea para Observaciones
        celda.innerHTML = `<textarea class="editing-textarea">${valorActual === "-" ? "" : valorActual}</textarea>`;
        
        const textarea = celda.querySelector("textarea");
        textarea.focus();
        textarea.select();
        
        textarea.addEventListener("blur", () => guardarEdicionCaliente(celda, id, campo, textarea.value));
        textarea.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                textarea.blur();
            } else if (e.key === "Escape") {
                restaurarCelda(celda, valorActual);
            }
        });
        
    } else if (campo === "Fecha Envio") {
        // Input date para Fecha de Envío
        const fechaISO = valorActual === "-" ? "" : convertirFechaAISO(valorActual);
        celda.innerHTML = `<input type="date" class="editing-input" value="${fechaISO}">`;
        
        const input = celda.querySelector("input");
        input.focus();
        
        input.addEventListener("change", () => guardarEdicionCaliente(celda, id, campo, input.value));
        input.addEventListener("blur", () => {
            setTimeout(() => {
                if (input.value !== fechaISO) {
                    guardarEdicionCaliente(celda, id, campo, input.value);
                } else {
                    restaurarCelda(celda, valorActual);
                }
            }, 100);
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                restaurarCelda(celda, valorActual);
            }
        });
    }
}

// Convierte fecha de formato "03/09/2026" a "2026-09-03"
function convertirFechaAISO(fechaLatino) {
    const partes = fechaLatino.split("/");
    if (partes.length !== 3) return "";
    const [dia, mes, anio] = partes;
    return `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

async function guardarEdicionCaliente(celda, id, campo, nuevoValor) {
    // Buscar la avería actual
    const averia = averias.find(a => a.id == id);
    if (!averia) return;
    
    // Crear objeto con todos los datos actuales
    const datos = {
        "Fecha": averia.Fecha,
        "Vendedor": averia.Vendedor,
        "Cliente": averia.Cliente,
        "Ciudad": averia.Ciudad,
        "Direccion": averia.Direccion,
        "Valor": averia.Valor,
        "Status Bodega": averia["Status Bodega"],
        "Status Averias": averia["Status Averias"],
        "Fecha Envio": averia["Fecha Envio"] || "",
        "Observaciones": averia.Observaciones || ""
    };
    
    // Actualizar el campo que cambió
    datos[campo] = nuevoValor;
    
    try {
        const respuesta = await fetch("/actualizar", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                hoja: NOMBRE_HOJA,
                id: parseInt(id),
                datos: datos
            })
        });
        
        const resultado = await respuesta.json();
        
        if (resultado.error) {
            alert("Error al actualizar: " + resultado.error);
            restaurarCelda(celda, averia[campo]);
            return;
        }
        
        // Actualizar en el array local
        averia[campo] = nuevoValor;
        
        // Si la avería se completó ((Enviada O Descontada) + Entregado), recargar tabla para ocultarla
        const statusBodegaCompleto = averia["Status Bodega"] === "Enviada" || averia["Status Bodega"] === "Descontada";
        if (statusBodegaCompleto && averia["Status Averias"] === "Entregado" && !mostrarCompletadas) {
            cargarAverias();
        } else {
            restaurarCelda(celda, nuevoValor || "-");
        }
        
    } catch (error) {
        console.error("Error al guardar:", error);
        alert("Error al guardar el cambio");
        restaurarCelda(celda, averia[campo]);
    }
}

function restaurarCelda(celda, valor) {
    const campo = celda.dataset.campo;
    if (campo === "Fecha Envio" && valor && valor !== "-") {
        celda.textContent = formatearFecha(valor);
    } else {
        celda.textContent = valor || "-";
    }
}

// Cerrar dropdowns al hacer clic fuera
document.addEventListener("click", () => {
    document.querySelectorAll(".dropdown-opciones.abierto").forEach(d => d.classList.remove("abierto"));
});
