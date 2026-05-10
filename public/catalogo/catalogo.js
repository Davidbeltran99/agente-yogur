const preparationOptions = Array.isArray(window.__CATALOG_PREPARATION_OPTIONS__)
  ? window.__CATALOG_PREPARATION_OPTIONS__
  : ["Normal", "Bajo en azúcar", "Poco colorante", "Sin azúcar", "Sin colorante"];
const whatsappNumber = window.__CATALOG_WHATSAPP_NUMBER__ || "";

const state = {
  products: [],
  filteredProducts: [],
  categories: [],
  audience: "all",
  category: "all",
  search: "",
  customerType: "public",
  customerName: null,
  phone: "",
  cart: []
};

const audienceTabs = document.getElementById("audienceTabs");
const categoryTabs = document.getElementById("categoryTabs");
const searchInput = document.getElementById("searchInput");
const productsGrid = document.getElementById("productsGrid");
const resultsMeta = document.getElementById("resultsMeta");
const phoneInput = document.getElementById("phoneInput");
const identifyButton = document.getElementById("identifyButton");
const clientTypeBadge = document.getElementById("clientTypeBadge");
const clientNameBadge = document.getElementById("clientNameBadge");
const clientHelpText = document.getElementById("clientHelpText");
const cartItems = document.getElementById("cartItems");
const cartClientType = document.getElementById("cartClientType");
const cartTotal = document.getElementById("cartTotal");
const checkoutButton = document.getElementById("checkoutButton");
const checkoutHelp = document.getElementById("checkoutHelp");
const cartFabDesktop = document.getElementById("cartFabDesktop");
const cartFabMobile = document.getElementById("cartFabMobile");
const cartFabCount = document.getElementById("cartFabCount");
const cartFabCountMobile = document.getElementById("cartFabCountMobile");
const cartPanel = document.getElementById("cartPanel");
const closeCartButton = document.getElementById("closeCartButton");
const emptyStateTemplate = document.getElementById("emptyStateTemplate");

const audienceOptions = [
  { id: "all", label: "Ver todos" },
  { id: "public", label: "Público" },
  { id: "distributor", label: "Distribuidor" }
];

function formatCurrency(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(number);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getEffectiveCustomerType() {
  return state.customerType === "distributor" ? "distributor" : "public";
}

function getDisplayProducts() {
  const search = state.search.trim().toLowerCase();
  return state.products.filter((product) => {
    if (state.audience === "public" && product.visiblePublico === false) {
      return false;
    }
    if (state.audience === "distributor" && product.visibleDistribuidor === false) {
      return false;
    }
    if (state.category !== "all" && product.categoria !== state.category) {
      return false;
    }
    if (!search) {
      return true;
    }
    const haystack = [product.nombre, product.descripcion, product.categoria, product.presentacion].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(search);
  });
}

function getProductPrice(product) {
  const tier = getEffectiveCustomerType();
  if (tier === "distributor" && Number.isFinite(product.prices?.distributor)) {
    return product.prices.distributor;
  }
  return product.prices?.public ?? product.price ?? 0;
}

function renderAudienceTabs() {
  audienceTabs.innerHTML = audienceOptions.map((tab) => `
    <button data-audience="${tab.id}" class="rounded-full px-4 py-2 text-sm font-semibold transition ${state.audience === tab.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300"}">${tab.label}</button>
  `).join("");
}

function renderCategoryTabs() {
  const categories = ["all", ...state.categories];
  categoryTabs.innerHTML = categories.map((category) => {
    const label = category === "all" ? "Todas las categorías" : category;
    return `<button data-category="${escapeHtml(category)}" class="rounded-full px-3 py-2 text-xs font-semibold transition ${state.category === category ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}">${escapeHtml(label)}</button>`;
  }).join("");
}

function renderProducts() {
  const products = getDisplayProducts();
  state.filteredProducts = products;
  resultsMeta.textContent = `${products.length} producto(s) visibles en catálogo`;

  if (!products.length) {
    productsGrid.innerHTML = emptyStateTemplate.innerHTML;
    return;
  }

  productsGrid.innerHTML = products.map((product) => {
    const price = getProductPrice(product);
    const stockLabel = Number.isFinite(product.stock) ? `Stock: ${product.stock}` : "Disponible";
    return `
      <article class="flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
        <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.nombre)}" class="h-52 w-full object-cover" />
        <div class="flex flex-1 flex-col p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">${escapeHtml(product.categoria || "Tellolac")}</p>
              <h3 class="mt-1 text-lg font-bold text-slate-900">${escapeHtml(product.nombre)}</h3>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">${escapeHtml(stockLabel)}</span>
          </div>
          <p class="mt-3 text-sm leading-6 text-slate-500">${escapeHtml(product.descripcion || "Producto disponible")}</p>
          <div class="mt-4 flex items-end justify-between gap-3">
            <div>
              <p class="text-xs text-slate-500">Precio ${getEffectiveCustomerType() === "distributor" ? "distribuidor" : "público"}</p>
              <strong class="text-2xl font-black text-slate-900">${formatCurrency(price)}</strong>
            </div>
            ${getEffectiveCustomerType() !== "distributor" && Number.isFinite(product.prices?.distributor) ? `<span class="text-right text-xs text-slate-400">Distribuidor: ${formatCurrency(product.prices.distributor)}</span>` : ""}
          </div>
          <div class="mt-4 grid gap-3">
            <label class="text-sm font-medium text-slate-700">
              Preparación
              <select data-preparation-for="${product.id}" class="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none">
                ${preparationOptions.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}
              </select>
            </label>
            <div class="grid grid-cols-[96px_1fr] gap-3">
              <label class="text-sm font-medium text-slate-700">
                Cantidad
                <input data-qty-for="${product.id}" type="number" min="1" value="1" class="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
              </label>
              <button data-add-product="${product.id}" class="mt-6 rounded-2xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600">Agregar al carrito</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderClientInfo() {
  const label = getEffectiveCustomerType() === "distributor" ? "Distribuidor" : "Público";
  clientTypeBadge.textContent = `Tipo cliente: ${label}`;
  cartClientType.textContent = label;
  if (state.customerName) {
    clientNameBadge.textContent = `Cliente: ${state.customerName}`;
    clientNameBadge.classList.remove("hidden");
  } else {
    clientNameBadge.classList.add("hidden");
  }

  clientHelpText.textContent = getEffectiveCustomerType() === "distributor"
    ? "Se detectó tu número como distribuidor activo. El total se calcula con ese precio."
    : "Si ya eres distribuidor registrado, detecta tu número para ver el precio correcto.";
}

function renderCart() {
  if (!state.cart.length) {
    cartItems.innerHTML = `
      <div class="rounded-3xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Aún no agregas productos. Elige una preparación y arma tu pedido.
      </div>
    `;
  } else {
    cartItems.innerHTML = state.cart.map((item) => `
      <article class="rounded-3xl border border-slate-200 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h4 class="font-semibold text-slate-900">${escapeHtml(item.nombre)}</h4>
            <p class="text-sm text-slate-500">${escapeHtml(item.preparation)} · ${item.quantity} unidad(es)</p>
            <p class="mt-1 text-sm font-semibold text-brand-700">${formatCurrency(item.subtotal)}</p>
          </div>
          <button data-remove-item="${item.id}" class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Quitar</button>
        </div>
      </article>
    `).join("");
  }

  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
  cartTotal.textContent = formatCurrency(total);
  cartFabCount.textContent = String(count);
  cartFabCountMobile.textContent = String(count);
}

function addToCart(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) {
    return;
  }

  const preparationInput = document.querySelector(`[data-preparation-for="${CSS.escape(productId)}"]`);
  const qtyInput = document.querySelector(`[data-qty-for="${CSS.escape(productId)}"]`);
  const preparation = preparationInput?.value || "Normal";
  const quantity = Math.max(1, Number(qtyInput?.value) || 1);
  const unitPrice = getProductPrice(product);
  const existing = state.cart.find((item) => item.productId === productId && item.preparation === preparation);

  if (existing) {
    existing.quantity += quantity;
    existing.subtotal = existing.quantity * existing.unitPrice;
  } else {
    state.cart.push({
      id: `${productId}-${preparation}-${Date.now()}`,
      productId,
      nombre: product.nombre,
      preparation,
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity
    });
  }

  renderCart();
}

function removeCartItem(itemId) {
  state.cart = state.cart.filter((item) => item.id !== itemId);
  renderCart();
}

async function loadProducts() {
  const response = await fetch(`/catalog/products?customerType=${encodeURIComponent(getEffectiveCustomerType())}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "No se pudo cargar el catálogo");
  }

  state.products = Array.isArray(payload.products) ? payload.products : [];
  state.categories = Array.isArray(payload.categories) ? payload.categories : [];
  renderAudienceTabs();
  renderCategoryTabs();
  renderProducts();
  renderClientInfo();
  renderCart();
  checkoutHelp.textContent = whatsappNumber
    ? "Al confirmar, se abrirá WhatsApp con tu pedido listo para Abi."
    : "Configura el número de WhatsApp del catálogo para habilitar el envío directo.";
}

async function identifyClient() {
  const phone = phoneInput.value.trim();
  state.phone = phone;
  if (!phone) {
    state.customerType = "public";
    state.customerName = null;
    renderClientInfo();
    await loadProducts();
    return;
  }

  identifyButton.disabled = true;
  identifyButton.textContent = "Validando...";
  try {
    const response = await fetch("/catalog/identify-client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "No se pudo identificar el cliente");
    }

    state.customerType = payload.customerType === "distributor" ? "distributor" : "public";
    state.customerName = payload.customerName || null;
    await loadProducts();
  } finally {
    identifyButton.disabled = false;
    identifyButton.textContent = "Detectar";
  }
}

function buildWhatsappMessage() {
  const total = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
  const lines = state.cart.map((item) => `- ${item.nombre} x${item.quantity} — ${item.preparation}`);
  const customerTypeLabel = getEffectiveCustomerType() === "distributor" ? "DISTRIBUIDOR" : "PUBLICO";
  const phoneLine = state.phone ? `Mi número es: ${state.phone}` : null;
  return [
    "Hola Abi, quiero hacer este pedido desde el catálogo web:",
    "",
    ...lines,
    "",
    `Tipo cliente: ${customerTypeLabel}`,
    `Total aproximado: ${formatCurrency(total)}`,
    phoneLine
  ].filter(Boolean).join("\n");
}

function openCheckout() {
  if (!state.cart.length) {
    alert("Agrega al menos un producto al carrito antes de enviarlo a WhatsApp.");
    return;
  }
  if (!whatsappNumber) {
    alert("Falta configurar el número de WhatsApp para el catálogo.");
    return;
  }

  const message = buildWhatsappMessage();
  const url = `https://wa.me/${encodeURIComponent(whatsappNumber)}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener");
}

function openCart() {
  cartPanel.classList.remove("hidden");
  cartPanel.classList.add("flex");
  document.body.classList.add("overflow-hidden", "lg:overflow-auto");
}

function closeCart() {
  if (window.innerWidth >= 1024) {
    return;
  }
  cartPanel.classList.add("hidden");
  cartPanel.classList.remove("flex");
  document.body.classList.remove("overflow-hidden", "lg:overflow-auto");
}

audienceTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-audience]");
  if (!button) {
    return;
  }
  state.audience = button.dataset.audience;
  renderAudienceTabs();
  renderProducts();
});

categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) {
    return;
  }
  state.category = button.dataset.category;
  renderCategoryTabs();
  renderProducts();
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  renderProducts();
});

productsGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-product]");
  if (!button) {
    return;
  }
  addToCart(button.dataset.addProduct);
});

cartItems.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-item]");
  if (!button) {
    return;
  }
  removeCartItem(button.dataset.removeItem);
});

identifyButton.addEventListener("click", () => {
  identifyClient().catch((error) => {
    console.error(error);
    alert(error.message || "No se pudo detectar el cliente");
  });
});

phoneInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    identifyButton.click();
  }
});

checkoutButton.addEventListener("click", openCheckout);
cartFabDesktop.addEventListener("click", openCart);
cartFabMobile.addEventListener("click", openCart);
closeCartButton.addEventListener("click", closeCart);
window.addEventListener("resize", () => {
  if (window.innerWidth >= 1024) {
    cartPanel.classList.remove("hidden");
    cartPanel.classList.add("flex");
    document.body.classList.remove("overflow-hidden", "lg:overflow-auto");
  } else {
    cartPanel.classList.add("hidden");
    cartPanel.classList.remove("flex");
  }
});

loadProducts().catch((error) => {
  console.error(error);
  resultsMeta.textContent = "No se pudo cargar el catálogo.";
  productsGrid.innerHTML = `<div class="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">${escapeHtml(error.message || "Error cargando catálogo")}</div>`;
  renderCart();
});
