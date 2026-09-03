// ============ CONFIGURACIÓN ============
// Mismo servidor: rutas relativas
const API_URL = "";
const NOMBRE_HOJA = "cajaMenor";

// ============ CARGAR DATOS AL ABRIR LA PÁGINA ============
document.addEventListener("DOMContentLoaded", () => {
    cargarMovimientos();
});

// ============ LEER DATOS ============
async function cargarMovimientos() {
    const tbody = document.getElementById("tablaMovimientos");

    try {
        const respuesta = await fetch(`/leer?hoja=${NOMBRE_HOJA}`);
        const data = await respuesta.json();

        if (data.error) {
            tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">Error: ${data.error}</td></tr>`;
            return;
        }

        mostrarMovimientos(data.datos);
        calcularTotal(data.datos);

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">Error al cargar datos</td></tr>`;
        console.error("Error:", error);
    }
}

// ============ MOSTRAR EN LA TABLA ============
function mostrarMovimientos(movimientos) {
    const tbody = document.getElementById("tablaMovimientos");

    if (movimientos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="sin-datos">No hay movimientos registrados</td></tr>`;
        return;
    }

    tbody.innerHTML = "";

    // Mostrar del más reciente al más antiguo (ya viene ordenado del backend)
    movimientos.forEach(mov => {
        const fila = document.createElement("tr");
        const esIngreso = mov.Tipo === "Ingreso";

        fila.innerHTML = `
            <td>${formatearFecha(mov.Fecha)}</td>
            <td><span class="${esIngreso ? 'badge-ingreso' : 'badge-salida'}">${esIngreso ? '💵' : '💸'} ${mov.Tipo}</span></td>
            <td>${mov["Descripción"]}</td>
            <td class="${esIngreso ? 'monto-ingreso' : 'monto-salida'}">${esIngreso ? '+' : '-'}$${formatearMonto(mov.Monto)}</td>
        `;
        // Menú de opciones (⋮) con modales
        const celdaOpciones = document.createElement("td");
        celdaOpciones.appendChild(crearMenuOpciones(mov));
        fila.appendChild(celdaOpciones);

        tbody.appendChild(fila);
    });
}

// ============ CALCULAR TOTAL ============
function calcularTotal(movimientos) {
    let total = 0;

    movimientos.forEach(mov => {
        const monto = parseFloat(mov.Monto) || 0;
        if (mov.Tipo === "Ingreso") {
            total += monto;
        } else {
            total -= monto;
        }
    });

    const totalElement = document.getElementById("totalCaja");
    totalElement.textContent = `$${formatearMonto(total)}`;
    totalElement.className = "total-monto " + (total >= 0 ? "positivo" : "negativo");
}

// ============ GUARDAR NUEVO MOVIMIENTO ============
document.getElementById("formMovimiento").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btnGuardar = e.target.querySelector("button");
    btnGuardar.disabled = true;
    btnGuardar.textContent = "⏳ Guardando...";

    const datos = {
        hoja: NOMBRE_HOJA,
        datos: {
            "Fecha": document.getElementById("fecha").value,
            "Tipo": document.getElementById("tipo").value,
            "Descripción": document.getElementById("descripcion").value,
            "Monto": document.getElementById("monto").value
        }
    };

    try {
        const respuesta = await fetch("/guardar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(datos)
        });

        const resultado = await respuesta.json();

        if (resultado.error) {
            alert("Error: " + resultado.error);
        }

        // Limpiar formulario y recargar tabla
        document.getElementById("formMovimiento").reset();
        cargarMovimientos();

    } catch (error) {
        console.error("Error al guardar:", error);
        alert("Error al guardar el registro");
    }

    btnGuardar.disabled = false;
    btnGuardar.textContent = "💾 Guardar";
});

// ============ FUNCIONES AUXILIARES ============
function formatearFecha(fecha) {
    if (!fecha) return "";
    const f = new Date(fecha);
    return f.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatearMonto(monto) {
    const num = parseFloat(monto) || 0;
    return num.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
