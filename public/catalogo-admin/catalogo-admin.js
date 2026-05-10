const adminMeta = document.getElementById("adminMeta");
const adminFeedback = document.getElementById("adminFeedback");
const adminSearchInput = document.getElementById("adminSearchInput");
const newProductButton = document.getElementById("newProductButton");
const productList = document.getElementById("productList");
const productForm = document.getElementById("productForm");
const formTitle = document.getElementById("formTitle");
const resetFormButton = document.getElementById("resetFormButton");
const productIdInput = document.getElementById("productIdInput");
const productNameInput = document.getElementById("productNameInput");
const productCategoryInput = document.getElementById("productCategoryInput");
const productPublicPriceInput = document.getElementById("productPublicPriceInput");
const productDistributorPriceInput = document.getElementById("productDistributorPriceInput");
const productPresentationInput = document.getElementById("productPresentationInput");
const productStockInput = document.getElementById("productStockInput");
const productDescriptionInput = document.getElementById("productDescriptionInput");
const productImageUrlInput = document.getElementById("productImageUrlInput");
const productImageFileInput = document.getElementById("productImageFileInput");
const productOrderInput = document.getElementById("productOrderInput");
const productAliasesInput = document.getElementById("productAliasesInput");
const productVisiblePublicInput = document.getElementById("productVisiblePublicInput");
const productVisibleDistributorInput = document.getElementById("productVisibleDistributorInput");
const productWebActiveInput = document.getElementById("productWebActiveInput");
const productActiveInput = document.getElementById("productActiveInput");
const saveProductButton = document.getElementById("saveProductButton");

const state = {
  products: [],
  search: ""
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(numeric);
}

function showFeedback(message, tone = "info") {
  const palette = {
    info: "bg-slate-100 text-slate-700",
    success: "bg-emerald-100 text-emerald-700",
    error: "bg-rose-100 text-rose-700"
  };
  adminFeedback.className = `mb-4 rounded-2xl px-4 py-3 text-sm ${palette[tone] || palette.info}`;
  adminFeedback.textContent = message;
  adminFeedback.classList.remove("hidden");
}

function hideFeedback() {
  adminFeedback.classList.add("hidden");
}

function resetForm() {
  productForm.reset();
  productIdInput.value = "";
  productOrderInput.value = "0";
  productVisiblePublicInput.checked = true;
  productVisibleDistributorInput.checked = true;
  productWebActiveInput.checked = true;
  productActiveInput.checked = true;
  formTitle.textContent = "Nuevo producto";
}

function fillForm(product) {
  productIdInput.value = product.id || "";
  productNameInput.value = product.nombre || "";
  productCategoryInput.value = product.categoria || "";
  productPublicPriceInput.value = product.prices?.public ?? product.price ?? "";
  productDistributorPriceInput.value = product.prices?.distributor ?? "";
  productPresentationInput.value = product.presentacion || "";
  productStockInput.value = product.stock ?? "";
  productDescriptionInput.value = product.descripcion || "";
  productImageUrlInput.value = product.imageUrl || "";
  productOrderInput.value = product.orden ?? 0;
  productAliasesInput.value = Array.isArray(product.aliases) ? product.aliases.join(", ") : "";
  productVisiblePublicInput.checked = product.visiblePublico !== false;
  productVisibleDistributorInput.checked = product.visibleDistribuidor !== false;
  productWebActiveInput.checked = product.webActivo !== false;
  productActiveInput.checked = product.activo !== false;
  formTitle.textContent = `Editando: ${product.nombre}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getVisibleProducts() {
  const search = state.search.trim().toLowerCase();
  return state.products.filter((product) => {
    if (!search) {
      return true;
    }
    return [product.nombre, product.descripcion, product.categoria, product.presentacion].filter(Boolean).join(" ").toLowerCase().includes(search);
  });
}

function renderProducts() {
  const products = getVisibleProducts();
  adminMeta.textContent = `${products.length} producto(s) en catálogo web`;

  if (!products.length) {
    productList.innerHTML = `<div class="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No hay productos con ese filtro.</div>`;
    return;
  }

  productList.innerHTML = products.map((product) => `
    <article class="rounded-3xl border border-slate-200 p-4">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="flex gap-4">
          <img src="${escapeHtml(product.imageUrl || "/assets/logo-tellolac.jpg")}" alt="${escapeHtml(product.nombre)}" class="h-24 w-24 rounded-2xl object-cover" />
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-lg font-bold text-slate-900">${escapeHtml(product.nombre)}</h3>
              <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">${escapeHtml(product.categoria || "Sin categoría")}</span>
              <span class="rounded-full ${product.webActivo === false ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"} px-3 py-1 text-xs font-semibold">${product.webActivo === false ? "Web inactivo" : "Web activo"}</span>
            </div>
            <p class="mt-2 text-sm text-slate-500">${escapeHtml(product.descripcion || "Sin descripción")}</p>
            <div class="mt-3 flex flex-wrap gap-3 text-sm">
              <span class="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">Público: ${formatCurrency(product.prices?.public || 0)}</span>
              <span class="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">Distribuidor: ${product.prices?.distributor ? formatCurrency(product.prices.distributor) : "—"}</span>
              <span class="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">Stock: ${product.stock ?? "—"}</span>
              <span class="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">Orden: ${product.orden ?? 0}</span>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 lg:justify-end">
          <button data-edit-product="${product.id}" class="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Editar</button>
          <button data-toggle-web="${product.id}" class="rounded-2xl ${product.webActivo === false ? "bg-emerald-500 hover:bg-emerald-600" : "bg-rose-500 hover:bg-rose-600"} px-4 py-2 text-sm font-semibold text-white transition">${product.webActivo === false ? "Activar web" : "Desactivar web"}</button>
        </div>
      </div>
    </article>
  `).join("");
}

async function loadProducts() {
  const response = await fetch("/admin/catalog-web/products", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "No se pudo cargar el catálogo web");
  }
  state.products = Array.isArray(payload.products) ? payload.products : [];
  renderProducts();
}

async function uploadImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });

  const response = await fetch("/admin/catalog-web/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, dataUrl })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "No se pudo subir la imagen");
  }
  return payload.imageUrl;
}

function buildPayload() {
  return {
    id: productIdInput.value || undefined,
    nombre: productNameInput.value.trim(),
    categoria: productCategoryInput.value.trim(),
    precio_publico: productPublicPriceInput.value,
    precio_distribuidor: productDistributorPriceInput.value || null,
    presentacion: productPresentationInput.value.trim(),
    stock: productStockInput.value || null,
    descripcion: productDescriptionInput.value.trim(),
    image_url: productImageUrlInput.value.trim(),
    orden: productOrderInput.value || 0,
    aliases: productAliasesInput.value,
    visible_publico: productVisiblePublicInput.checked,
    visible_distribuidor: productVisibleDistributorInput.checked,
    web_activo: productWebActiveInput.checked,
    activo: productActiveInput.checked
  };
}

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideFeedback();
  saveProductButton.disabled = true;
  saveProductButton.textContent = "Guardando...";

  try {
    if (productImageFileInput.files?.[0]) {
      const uploaded = await uploadImage(productImageFileInput.files[0]);
      productImageUrlInput.value = uploaded;
    }

    const payload = buildPayload();
    const isEditing = Boolean(productIdInput.value);
    const endpoint = isEditing ? `/admin/catalog-web/products/${encodeURIComponent(productIdInput.value)}` : "/admin/catalog-web/products";
    const method = isEditing ? "PATCH" : "POST";

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "No se pudo guardar el producto");
    }

    showFeedback("Producto guardado correctamente.", "success");
    resetForm();
    await loadProducts();
  } catch (error) {
    console.error(error);
    showFeedback(error.message || "No se pudo guardar el producto", "error");
  } finally {
    saveProductButton.disabled = false;
    saveProductButton.textContent = "Guardar producto";
  }
});

productList.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-product]");
  if (editButton) {
    const product = state.products.find((item) => item.id === editButton.dataset.editProduct);
    if (product) {
      fillForm(product);
    }
    return;
  }

  const toggleButton = event.target.closest("[data-toggle-web]");
  if (!toggleButton) {
    return;
  }

  const product = state.products.find((item) => item.id === toggleButton.dataset.toggleWeb);
  if (!product) {
    return;
  }

  try {
    const response = await fetch(`/admin/catalog-web/products/${encodeURIComponent(product.id)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webActivo: !product.webActivo, activo: product.activo })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "No se pudo actualizar el estado");
    }
    showFeedback("Estado del catálogo web actualizado.", "success");
    await loadProducts();
  } catch (error) {
    console.error(error);
    showFeedback(error.message || "No se pudo actualizar el estado", "error");
  }
});

adminSearchInput.addEventListener("input", () => {
  state.search = adminSearchInput.value;
  renderProducts();
});

resetFormButton.addEventListener("click", () => {
  hideFeedback();
  resetForm();
});

newProductButton.addEventListener("click", () => {
  resetForm();
  productNameInput.focus();
});

resetForm();
loadProducts().catch((error) => {
  console.error(error);
  showFeedback(error.message || "No se pudo cargar el catálogo web", "error");
});
