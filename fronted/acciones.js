// ============ ACCIONES: MENÚ ⋮ Y MODALES (compartido) ============
// Requiere que la página tenga:
//   - variable global NOMBRE_HOJA
//   - función global cargarMovimientos()
//   - elemento #opcionesTipo con <option>s para el select de tipo

let registroEditando = null;
let registroBorrando = null;

// ============ MENÚ ⋮ ============
function crearMenuOpciones(mov) {
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
        // Cerrar otros dropdowns abiertos
        document.querySelectorAll(".dropdown-opciones.abierto").forEach(d => {
            if (d !== dropdown) d.classList.remove("abierto");
        });
        dropdown.classList.toggle("abierto");
    });

    contenedor.querySelector(".opcion-editar").addEventListener("click", () => {
        dropdown.classList.remove("abierto");
        abrirModalEditar(mov);
    });

    contenedor.querySelector(".opcion-borrar").addEventListener("click", () => {
        dropdown.classList.remove("abierto");
        abrirModalBorrar(mov);
    });

    return contenedor;
}

// Cerrar dropdowns al hacer clic fuera
document.addEventListener("click", () => {
    document.querySelectorAll(".dropdown-opciones.abierto").forEach(d => d.classList.remove("abierto"));
});

// ============ MODAL EDITAR ============
function abrirModalEditar(mov) {
    registroEditando = mov;
    document.getElementById("editFecha").value = formatearFechaInput(mov.Fecha);

    // Seleccionar la opción correcta en el select
    const selectTipo = document.getElementById("editTipo");
    selectTipo.value = mov.Tipo;

    document.getElementById("editDescripcion").value = mov["Descripción"];
    document.getElementById("editMonto").value = parseInt(mov.Monto) || 0;
    document.getElementById("modalEditarFondo").classList.add("abierto");
}

function cerrarModalEditar() {
    registroEditando = null;
    document.getElementById("modalEditarFondo").classList.remove("abierto");
}

async function guardarEdicion() {
    if (!registroEditando) return;

    const datos = {
        hoja: NOMBRE_HOJA,
        id: registroEditando.id,
        datos: {
            "Fecha": document.getElementById("editFecha").value,
            "Tipo": document.getElementById("editTipo").value,
            "Descripción": document.getElementById("editDescripcion").value,
            "Monto": document.getElementById("editMonto").value
        }
    };

    try {
        const respuesta = await fetch("/actualizar", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(datos)
        });
        const resultado = await respuesta.json();
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        cerrarModalEditar();
        cargarMovimientos();
    } catch (error) {
        console.error("Error al actualizar:", error);
        alert("Error al actualizar el registro");
    }
}

// ============ MODAL BORRAR ============
function abrirModalBorrar(mov) {
    registroBorrando = mov;
    document.getElementById("borrarDescripcion").textContent =
        `"${mov["Descripción"]}" — $${formatearMonto(mov.Monto)}`;
    document.getElementById("modalBorrarFondo").classList.add("abierto");
}

function cerrarModalBorrar() {
    registroBorrando = null;
    document.getElementById("modalBorrarFondo").classList.remove("abierto");
}

async function confirmarBorrar() {
    if (!registroBorrando) return;

    try {
        const respuesta = await fetch("/borrar", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hoja: NOMBRE_HOJA, id: registroBorrando.id })
        });
        const resultado = await respuesta.json();
        if (resultado.error) {
            alert("Error: " + resultado.error);
            return;
        }
        cerrarModalBorrar();
        cargarMovimientos();
    } catch (error) {
        console.error("Error al borrar:", error);
        alert("Error al borrar el registro");
    }
}

// ============ AUXILIAR ============
// Convierte fecha al formato YYYY-MM-DD que acepta <input type="date">
function formatearFechaInput(fecha) {
    if (!fecha) return "";
    const f = new Date(fecha);
    const yyyy = f.getFullYear();
    const mm = String(f.getMonth() + 1).padStart(2, "0");
    const dd = String(f.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

// Cerrar modales al hacer clic en el fondo oscuro
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("modalEditarFondo").addEventListener("click", (e) => {
        if (e.target.id === "modalEditarFondo") cerrarModalEditar();
    });
    document.getElementById("modalBorrarFondo").addEventListener("click", (e) => {
        if (e.target.id === "modalBorrarFondo") cerrarModalBorrar();
    });
    document.getElementById("btnGuardarEdicion").addEventListener("click", guardarEdicion);
    document.getElementById("btnCancelarEdicion").addEventListener("click", cerrarModalEditar);
    document.getElementById("btnConfirmarBorrar").addEventListener("click", confirmarBorrar);
    document.getElementById("btnCancelarBorrar").addEventListener("click", cerrarModalBorrar);

    // Botón de sincronización manual en el nav
    const btnSync = document.getElementById("btnSync");
    if (btnSync) btnSync.addEventListener("click", forzarSync);
});

// ============ SINCRONIZACIÓN MANUAL ============
async function forzarSync() {
    const btnSync = document.getElementById("btnSync");
    btnSync.disabled = true;
    btnSync.textContent = "⏳";

    try {
        const respuesta = await fetch("/sincronizar", { method: "POST" });
        const resultado = await respuesta.json();

        if (resultado.pendientes === 0) {
            btnSync.textContent = "✅";
        } else {
            btnSync.textContent = `⚠️ ${resultado.pendientes}`;
        }
        // Recargar la tabla por si hubo cambios de estado
        cargarMovimientos();
    } catch (error) {
        console.error("Error al sincronizar:", error);
        btnSync.textContent = "❌";
    }

    // Volver al estado normal después de 2 segundos
    setTimeout(() => {
        btnSync.disabled = false;
        btnSync.textContent = "🔄 Sync";
    }, 2000);
}
