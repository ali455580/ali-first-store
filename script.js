/* ==========================================
   إعداد Firebase
   ========================================== */
const firebaseConfig = {
    apiKey: "AIzaSyBcxuhiFes6nuTPhTpn-IlBUJlvaCQD0zE",
    authDomain: "ali-first-store.firebaseapp.com",
    projectId: "ali-first-store",
    storageBucket: "ali-first-store.firebasestorage.app",
    messagingSenderId: "1043684903047",
    appId: "1:1043684903047:web:fbdcc1638aed65a3999022"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

const productsCol = db.collection('products');
const categoriesDoc = db.collection('meta').doc('categories');
const themeDoc = db.collection('meta').doc('theme');
const ordersCol = db.collection('orders');
const chatsCol = db.collection('chats');
const userNotifCol = db.collection('userNotifications');

const DEFAULT_CATEGORIES = ['الكل', 'ألكترونيات', 'شاشات', 'غسالات', 'ثلاجات', 'مكيفات'];

let categories = [...DEFAULT_CATEGORIES];
let products = [];
let orders = [];
let chatMessages = [];
let userNotifications = [];
let siteNotifications = JSON.parse(localStorage.getItem('ali_site_notifications')) || [];

const DELIVERY_FEE = 5000;
const PRODUCTS_BATCH_SIZE = 20;

let cart = [];
let currentCategory = 'الكل';
let searchQuery = '';
let tempImages = [];
let editingProductId = null;
let logoClickCount = 0;
let logoClickTimer = null;
let lastRenderedNotifKey = '';
let knownChatMessageIds = new Set();
let firstProductsLoad = true;
let productsListCollapsed = false;
let visibleProductsCount = PRODUCTS_BATCH_SIZE;

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (err) {
        showNotification("تعذر الحفظ محلياً.", 'danger');
        console.error('Storage error:', err);
        return false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    setupSecretTriggers();
    initCategories();
    setupFirestoreListeners();
    checkUserOrderStatus();
    renderSiteNotifications();
    setInterval(renderSiteNotifications, 1000);

    auth.onAuthStateChanged(user => {
        if (user) {
            showAdminControls();
        } else {
            const ctrlBtn = document.getElementById('admin-control-btn');
            const notifBtn = document.getElementById('admin-notif-btn');
            const chatBtn = document.getElementById('admin-chat-notif-btn');
            const panel = document.getElementById('admin-panel');
            if (ctrlBtn) ctrlBtn.classList.add('hidden');
            if (notifBtn) notifBtn.classList.add('hidden');
            if (chatBtn) chatBtn.classList.add('hidden');
            if (panel) panel.classList.add('hidden');
        }
    });
});

/* ==========================================
   تهيئة الأقسام لمرة واحدة فقط
   ========================================== */
function initCategories() {
    categoriesDoc.get().then(doc => {
        if (!doc.exists || !Array.isArray(doc.data().list) || !doc.data().list.length) {
            categoriesDoc.set({ list: DEFAULT_CATEGORIES }).catch(err => console.error(err));
        }
    }).catch(err => console.error('initCategories error:', err));
}

/* ==========================================
   الاستماع المباشر لتغييرات Firestore
   ========================================== */
function setupFirestoreListeners() {
    categoriesDoc.onSnapshot(doc => {
        if (doc.exists && Array.isArray(doc.data().list) && doc.data().list.length) {
            categories = doc.data().list;
        }
        renderCategories();
    }, err => console.error('categories listener error:', err));

    themeDoc.onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            if (data.primary) document.documentElement.style.setProperty('--primary-color', data.primary);
            if (data.secondary) document.documentElement.style.setProperty('--secondary-color', data.secondary);
        }
    }, err => console.error('theme listener error:', err));

    productsCol.onSnapshot(snap => {
        products = snap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a, b) => (a.order || 0) - (b.order || 0));
        firstProductsLoad = false;
        renderProducts();
        if (auth.currentUser) renderAdminList();
    }, err => {
        console.error('products listener error:', err);
        firstProductsLoad = false;
        const loadingEl = document.getElementById('products-loading');
        if (loadingEl) loadingEl.classList.add('hidden');
    });

    ordersCol.onSnapshot(snap => {
        orders = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        checkUserOrderStatus();
        renderMyOrders();
        if (auth.currentUser) renderOrders();
    }, err => console.error('orders listener error:', err));

    chatsCol.orderBy('createdAt', 'asc').onSnapshot(snap => {
        const newMessages = snap.docs.map(d => ({ ...d.data(), id: d.id }));

        if (auth.currentUser) {
            newMessages.forEach(m => {
                if (m.sender === 'user' && !knownChatMessageIds.has(m.id) && knownChatMessageIds.size > 0) {
                    showNotification(`رسالة جديدة من الزبون: ${m.name || 'غير معروف'}`, 'info');
                }
            });
        }
        newMessages.forEach(m => knownChatMessageIds.add(m.id));

        chatMessages = newMessages;
        renderUserChatModal();
        if (auth.currentUser) renderAdminChat();
    }, err => console.error('chats listener error:', err));

    userNotifCol.onSnapshot(snap => {
        userNotifications = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        renderUserNotifications();
    }, err => console.error('notifications listener error:', err));
}

function setupSecretTriggers() {
    const logo = document.getElementById('admin-secret-trigger');
    if (!logo) return;

    logo.addEventListener('click', () => {
        logoClickCount++;
        clearTimeout(logoClickTimer);

        if (logoClickCount >= 3) {
            logoClickCount = 0;
            openAdminModal();
        } else {
            logoClickTimer = setTimeout(() => { logoClickCount = 0; }, 1000);
        }
    });
}

/* ==========================================
   نظام التنبيهات
   ========================================== */
function showNotification(msg, type = 'info') {
    const alreadyShown = siteNotifications.some(n => n && n.message === msg && n.type === type);
    if (alreadyShown) return;

    const notif = {
        id: Date.now() + '_' + Math.floor(Math.random() * 10000),
        message: msg,
        type,
        createdAt: Date.now(),
        time: new Date().toLocaleTimeString('ar-IQ')
    };
    siteNotifications.push(notif);
    if (siteNotifications.length > 25) siteNotifications = siteNotifications.slice(-25);
    safeSetItem('ali_site_notifications', JSON.stringify(siteNotifications));
    renderSiteNotifications();
}

function dismissNotification(id) {
    siteNotifications = siteNotifications.filter(n => n && n.id !== id);
    safeSetItem('ali_site_notifications', JSON.stringify(siteNotifications));
    renderSiteNotifications();
}

function pruneExpiredNotifications() {
    const now = Date.now();
    const before = siteNotifications.length;
    siteNotifications = siteNotifications.filter(n => n && (now - (n.createdAt || 0)) < 10000);
    if (siteNotifications.length !== before) {
        safeSetItem('ali_site_notifications', JSON.stringify(siteNotifications));
    }
}

function renderSiteNotifications() {
    const area = document.getElementById('notification-area');
    if (!area) return;

    pruneExpiredNotifications();

    const visible = siteNotifications.slice(-8);
    const key = visible.map(n => n.id).join(',');

    if (key === lastRenderedNotifKey) return;
    lastRenderedNotifKey = key;

    area.innerHTML = visible.map(n => n ? `
        <div class="site-notice notice-${n.type || 'info'}">
            <span>🔔 ${n.message || ''}</span>
            <i class="fa-solid fa-xmark" onclick="dismissNotification('${n.id}')"></i>
        </div>
    ` : '').join('');
}

function checkUserOrderStatus() {
    const lastOrderId = localStorage.getItem('ali_last_order_id');
    const banner = document.getElementById('order-status-banner');
    if (!lastOrderId || !banner) return;

    const myOrder = orders.find(o => o && o.id == lastOrderId);
    if (myOrder && myOrder.status) {
        banner.classList.remove('hidden');
        banner.innerHTML = `<div class="order-banner">📦 حالة طلبك الأخير: <strong>${myOrder.status}</strong></div>`;
    }
}

/* ==========================================
   سجل طلبات الزبون
   ========================================== */
function getMyOrderIds() {
    return JSON.parse(localStorage.getItem('ali_my_order_ids')) || [];
}

function addMyOrderId(orderId) {
    const ids = getMyOrderIds();
    ids.push(orderId);
    localStorage.setItem('ali_my_order_ids', JSON.stringify(ids));
}

function renderMyOrders() {
    const list = document.getElementById('my-orders-list');
    if (!list) return;

    const myIds = getMyOrderIds();
    const myOrders = orders.filter(o => o && myIds.includes(o.id));

    if (myOrders.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#777; padding:10px;">لا توجد طلبات سابقة.</p>';
        return;
    }

    list.innerHTML = myOrders.slice().reverse().map(o => {
        let itemsHtml = Array.isArray(o.items) ? o.items.map(i => i ? i.name : '').join(' ، ') : '';
        return `
            <div style="background:#f8f9fa; border:1px solid #ddd; padding:12px; margin-bottom:10px; border-radius:8px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:bold; color:var(--primary-color);">${o.date || ''}</span>
                    <span style="font-size:0.8rem; background:#fff3cd; color:#856404; padding:3px 10px; border-radius:12px; font-weight:bold;">${o.status || 'قيد المراجعة'}</span>
                </div>
                <p style="margin:8px 0 4px; font-size:0.9rem;"><b>الأجهزة:</b> ${itemsHtml}</p>
                <p style="margin:4px 0; font-size:0.9rem;"><b>المجموع الكلي:</b> ${(o.total || 0).toLocaleString('ar-IQ')} د.ع</p>
            </div>
        `;
    }).join('');
}

function renderUserNotifications() {
    const list = document.getElementById('user-notifications-list');
    const countBadge = document.getElementById('user-notif-count');
    if (!list) return;

    const lastOrderId = localStorage.getItem('ali_last_order_id');
    const myNotifications = userNotifications.filter(n => n && n.orderId == lastOrderId);

    if (countBadge) countBadge.innerText = myNotifications.filter(n => !n.read).length;

    if (myNotifications.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#777; padding:10px;">لا توجد إشعارات حالياً.</p>';
        return;
    }

    list.innerHTML = myNotifications.slice().reverse().map(n => `
        <div style="background: #f8f9fa; border-right: 4px solid #2196f3; padding: 10px; margin-bottom: 8px; border-radius: 4px;">
            <p style="margin:0; font-weight:bold;">${n.title || ''}</p>
            <p style="margin:3px 0; font-size:0.9rem;">${n.message || ''}</p>
            <small style="color:#888;">${n.time || ''}</small>
        </div>
    `).join('');
}

function addUserNotification(orderId, title, message) {
    userNotifCol.add({
        orderId: String(orderId),
        title,
        message,
        time: new Date().toLocaleTimeString('ar-IQ'),
        read: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.error(err));
}

function renderCategories() {
    const filterContainer = document.getElementById('categories-filter');
    const adminCatList = document.getElementById('admin-categories-list');
    const pCategorySelect = document.getElementById('p-category');

    if (filterContainer) {
        filterContainer.innerHTML = categories.map(cat => {
            const activeClass = cat === currentCategory ? 'active' : '';
            return `<button class="cat-btn ${activeClass}" onclick="filterProducts('${cat}')">${cat}</button>`;
        }).join('');
    }

    if (pCategorySelect) {
        pCategorySelect.innerHTML = categories.filter(c => c !== 'الكل').map(cat => `<option value="${cat}">${cat}</option>`).join('');
    }

    if (adminCatList) {
        adminCatList.innerHTML = categories.filter(c => c !== 'الكل').map(cat => `
            <span class="tag" style="background:#eee; padding:4px 10px; border-radius:15px; display:inline-block; margin:3px;">
                ${cat} <i class="fa-solid fa-xmark" style="color:red; cursor:pointer;" onclick="deleteCategory('${cat}')"></i>
            </span>
        `).join('');
    }
}

function addCategory() {
    const input = document.getElementById('new-cat-name');
    const newCat = input ? input.value.trim() : '';
    if (newCat && !categories.includes(newCat)) {
        const updated = [...categories, newCat];
        categoriesDoc.set({ list: updated }).then(() => {
            input.value = '';
            showNotification("تم إضافة القسم بنجاح", 'success');
        }).catch(err => {
            console.error(err);
            showNotification("تعذر إضافة القسم", 'danger');
        });
    }
}

function deleteCategory(cat) {
    const updated = categories.filter(c => c !== cat);
    categoriesDoc.set({ list: updated }).then(() => {
        showNotification("تم حذف القسم", 'danger');
    }).catch(err => console.error(err));
}

function filterProducts(cat) {
    currentCategory = cat;
    visibleProductsCount = PRODUCTS_BATCH_SIZE;
    renderCategories();
    renderProducts();
}

function handleSearch(value) {
    searchQuery = (value || '').trim().toLowerCase();
    visibleProductsCount = PRODUCTS_BATCH_SIZE;
    renderProducts();
}

/* ==========================================
   معالجة الصور (مصغّرة أكثر لتحسين السرعة)
   ========================================== */
function previewImage(event) {
    const files = Array.from(event.target.files || []);

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function (e) {
            resizeImage(e.target.result, 350, 0.35, function (resizedBase64) {
                tempImages.push(resizedBase64);
                renderImagePreviews();
            });
        };
        reader.readAsDataURL(file);
    });
}

function resizeImage(base64, maxWidth, quality, callback) {
    const img = new Image();
    img.onload = function () {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = base64;
}

function renderImagePreviews() {
    const box = document.getElementById('img-preview-box');
    if (!box) return;

    if (tempImages.length === 0) {
        box.innerHTML = '';
        box.classList.add('hidden');
        return;
    }

    box.classList.remove('hidden');
    box.innerHTML = tempImages.map((img, i) => `
        <div class="img-preview-item">
            <img src="${img}" alt="معاينة">
            <span class="remove-preview-img" onclick="removeTempImage(${i})">&times;</span>
        </div>
    `).join('');
}

function removeTempImage(index) {
    tempImages.splice(index, 1);
    renderImagePreviews();
}

function getProductImages(p) {
    if (p.images && p.images.length) return p.images;
    if (p.img) return [p.img];
    return ['https://via.placeholder.com/200'];
}

/* ==========================================
   عرض المنتجات مع تحميل تدريجي (20 منتج أولاً)
   ========================================== */
function renderProducts() {
    const grid = document.getElementById('products-grid');
    const loadingEl = document.getElementById('products-loading');
    if (!grid) return;

    if (loadingEl && !firstProductsLoad) loadingEl.classList.add('hidden');

    let filtered = currentCategory === 'الكل' ? products.slice() : products.filter(p => p && p.category === currentCategory);

    if (searchQuery) {
        filtered = filtered.filter(p => p && p.name && p.name.toLowerCase().includes(searchQuery));
    }

    if (filtered.length === 0) {
        grid.innerHTML = `<p style="grid-column: 1/-1; text-align:center;">${searchQuery ? 'لا توجد نتائج مطابقة لبحثك.' : (firstProductsLoad ? '' : 'لا توجد منتجات متاحة حالياً.')}</p>`;
        return;
    }

    const visible = filtered.slice(0, visibleProductsCount);
    const hasMore = filtered.length > visibleProductsCount;

    grid.innerHTML = visible.map(p => {
        if (!p) return '';
        const isAvailable = p.available !== false;
        const mainImg = getProductImages(p)[0];

        return `
            <div class="product-card">
                <div class="product-img-wrap">
                    <img class="main-img" src="${mainImg}" alt="${p.name || ''}" loading="lazy" onclick="openProductDetails('${p.id}')" style="cursor:pointer;">
                    <span class="stock-badge ${isAvailable ? 'in-stock' : 'out-stock'}">${isAvailable ? 'متوفر' : 'غير متوفر'}</span>
                </div>
                <div class="product-info">
                    <span class="product-category-tag">${p.category || ''}</span>
                    <h3 onclick="openProductDetails('${p.id}')" style="cursor:pointer;">${p.name || ''}</h3>
                    <div class="price">${(p.price || 0).toLocaleString('ar-IQ')} د.ع</div>
                    <div style="display:flex; gap:6px;">
                        <button class="btn-gold" style="flex:1;" onclick="addToCart('${p.id}')" ${isAvailable ? '' : 'disabled'}>
                            <i class="fa-solid fa-cart-plus"></i> ${isAvailable ? 'إضافة للسلة' : 'غير متوفر'}
                        </button>
                        <button class="btn-action" style="padding:8px 10px;" onclick="openProductDetails('${p.id}')">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (hasMore) {
        grid.innerHTML += `
            <div style="grid-column: 1/-1; text-align:center; padding:15px;">
                <button class="btn-action" style="padding:10px 25px;" onclick="loadMoreProducts()">
                    عرض المزيد (${filtered.length - visibleProductsCount} متبقي)
                </button>
            </div>
        `;
    }
}

function loadMoreProducts() {
    visibleProductsCount += PRODUCTS_BATCH_SIZE;
    renderProducts();
}

function openProductDetails(id) {
    const p = products.find(prod => prod && prod.id === id);
    if (!p) return;

    const body = document.getElementById('product-detail-body');
    if (!body) return;

    const images = getProductImages(p);
    const isAvailable = p.available !== false;

    body.innerHTML = `
        <img id="detail-main-img" src="${images[0]}" style="width:100%; height:240px; object-fit:cover; border-radius:8px;">
        <div style="display:flex; gap:8px; margin:10px 0; overflow-x:auto;">
            ${images.map((img, i) => `<img src="${img}" loading="lazy" onclick="document.getElementById('detail-main-img').src='${img}'" style="width:55px; height:55px; object-fit:cover; border-radius:6px; cursor:pointer; border:2px solid ${i === 0 ? 'var(--accent-gold)' : 'transparent'};">`).join('')}
        </div>
        <span class="product-category-tag">${p.category || ''}</span>
        <span class="stock-badge ${isAvailable ? 'in-stock' : 'out-stock'}" style="position:static; display:inline-block; margin-right:6px;">${isAvailable ? 'متوفر' : 'غير متوفر'}</span>
        <h2 style="margin:8px 0; color:var(--primary-color); font-size:1.2rem;">${p.name || ''}</h2>
        <p style="margin:10px 0; color:var(--text-muted); line-height:1.8; white-space: pre-wrap; font-size:0.9rem;">${p.description ? p.description : 'لا يوجد وصف تفصيلي لهذا المنتج.'}</p>
        <div class="price" style="font-size:1.3rem;">${(p.price || 0).toLocaleString('ar-IQ')} د.ع</div>
        <button class="btn-gold" style="width:100%; margin-top:10px;" onclick="addToCart('${p.id}')" ${isAvailable ? '' : 'disabled'}>
            <i class="fa-solid fa-cart-plus"></i> ${isAvailable ? 'إضافة للسلة' : 'غير متوفر حالياً'}
        </button>
    `;
    toggleModal('product-detail-modal');
}

function addToCart(id) {
    const p = products.find(prod => prod && prod.id === id);
    if (!p) return;

    if (p.available === false) {
        showNotification(`عذراً، المنتج (${p.name}) غير متوفر حالياً`, 'danger');
        return;
    }

    cart.push(p);
    const countEl = document.getElementById('cart-count');
    if (countEl) countEl.innerText = cart.length;
    showNotification(`تمت إضافة (${p.name}) للسلة`, 'success');
}

function isAnyModalOpen() {
    return Array.from(document.querySelectorAll('.modal')).some(m => m.style.display === 'block');
}

function toggleModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const opening = modal.style.display !== 'block';
    modal.style.display = opening ? 'block' : 'none';

    document.body.classList.toggle('modal-open', isAnyModalOpen());

    if (modalId === 'cart-modal') renderCartModal();
    if (modalId === 'my-orders-modal') renderMyOrders();
    if (modalId === 'user-notif-modal') {
        userNotifications.forEach(n => {
            if (n && !n.read) {
                userNotifCol.doc(n.id).update({ read: true }).catch(() => {});
            }
        });
    }
}

function renderCartModal() {
    const container = document.getElementById('cart-items');
    if (!container) return;
    let subtotal = 0;

    if (cart.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#777;">السلة فارغة.</p>';
    } else {
        container.innerHTML = cart.map((item, index) => {
            if (!item) return '';
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span>${item.name || ''}</span>
                    <b>${(item.price || 0).toLocaleString('ar-IQ')} د.ع</b>
                    <button class="btn-danger" style="padding:2px 6px;" onclick="removeFromCart(${index})">X</button>
                </div>
            `;
        }).join('');
        subtotal = cart.reduce((sum, item) => sum + (item.price || 0), 0);
    }

    const delivery = cart.length > 0 ? DELIVERY_FEE : 0;
    const grandTotal = subtotal + delivery;

    const subtotalEl = document.getElementById('cart-subtotal');
    const deliveryEl = document.getElementById('cart-delivery');
    const totalEl = document.getElementById('cart-total');
    if (subtotalEl) subtotalEl.innerText = subtotal.toLocaleString('ar-IQ');
    if (deliveryEl) deliveryEl.innerText = delivery.toLocaleString('ar-IQ');
    if (totalEl) totalEl.innerText = grandTotal.toLocaleString('ar-IQ');
}

function removeFromCart(index) {
    cart.splice(index, 1);
    const countEl = document.getElementById('cart-count');
    if (countEl) countEl.innerText = cart.length;
    renderCartModal();
}

function handleCheckout(e) {
    e.preventDefault();
    if (cart.length === 0) {
        showNotification("السلة فارغة!", 'danger');
        return;
    }

    const subtotal = cart.reduce((sum, item) => sum + (item.price || 0), 0);
    const delivery = DELIVERY_FEE;

    const order = {
        name: document.getElementById('cust-name').value,
        phone: document.getElementById('cust-phone').value,
        address: document.getElementById('cust-address').value,
        items: cart.map(i => ({ name: i.name, price: i.price })),
        subtotal,
        delivery,
        total: subtotal + delivery,
        status: 'قيد المراجعة ⏳',
        completed: false,
        date: new Date().toLocaleString('ar-IQ'),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    ordersCol.add(order).then(docRef => {
        const orderId = docRef.id;
        localStorage.setItem('ali_last_order_id', orderId);
        addMyOrderId(orderId);
        addUserNotification(orderId, "تم استلام طلبك", "طلبك الآن قيد المراجعة من قبل الإدارة ⏳ (شامل سعر التوصيل 5,000 د.ع)");

        cart = [];
        const countEl = document.getElementById('cart-count');
        if (countEl) countEl.innerText = '0';
        toggleModal('cart-modal');
        document.getElementById('checkout-form').reset();

        showNotification("تم إرسال طلبك بنجاح!", 'success');
        checkUserOrderStatus();
    }).catch(err => {
        console.error(err);
        showNotification("تعذر إرسال الطلب، حاول مرة أخرى", 'danger');
    });
}

function openAdminModal() { toggleModal('login-modal'); }

function loginAdmin() {
    const emailInput = document.getElementById('admin-email');
    const passInput = document.getElementById('admin-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const pass = passInput ? passInput.value : '';

    if (!email || !pass) {
        showNotification("الرجاء إدخال البريد وكلمة المرور", 'danger');
        return;
    }

    auth.signInWithEmailAndPassword(email, pass).then(() => {
        toggleModal('login-modal');
        showNotification("مرحباً بك! تم تسجيل الدخول كمسؤول.", 'success');
    }).catch(err => {
        console.error(err);
        showNotification("البريد أو كلمة المرور غير صحيحة!", 'danger');
    });
}

function showAdminControls() {
    const ctrlBtn = document.getElementById('admin-control-btn');
    const notifBtn = document.getElementById('admin-notif-btn');
    const panel = document.getElementById('admin-panel');

    if (ctrlBtn) ctrlBtn.classList.remove('hidden');
    if (notifBtn) notifBtn.classList.remove('hidden');
    if (panel) panel.classList.remove('hidden');

    renderAdminList();
    renderOrders();
    renderAdminChat();
    updateAdminChatBadge();
}

function logoutAdmin() {
    auth.signOut().then(() => {
        const ctrlBtn = document.getElementById('admin-control-btn');
        const notifBtn = document.getElementById('admin-notif-btn');
        const chatBtn = document.getElementById('admin-chat-notif-btn');
        const panel = document.getElementById('admin-panel');

        if (ctrlBtn) ctrlBtn.classList.add('hidden');
        if (notifBtn) notifBtn.classList.add('hidden');
        if (chatBtn) chatBtn.classList.add('hidden');
        if (panel) panel.classList.add('hidden');
        showNotification("تم الخروج وإخفاء لوحة التحكم.", 'info');
    }).catch(err => console.error(err));
}

function scrollToAdminPanel() {
    const panel = document.getElementById('admin-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth' });
}

function scrollToOrdersSection() {
    const section = document.getElementById('admin-orders-section');
    if (section) section.scrollIntoView({ behavior: 'smooth' });
}

/* ==========================================
   إدارة الطلبات
   ========================================== */
function renderOrders() {
    const incomingList = document.getElementById('admin-orders-list');
    const completedList = document.getElementById('admin-completed-orders-list');
    const notifCount = document.getElementById('admin-notif-count');

    if (!incomingList) return;

    const pendingOrders = orders.filter(o => o && !o.completed && o.status && typeof o.status === 'string' && o.status.includes('المراجعة'));
    if (notifCount) notifCount.innerText = pendingOrders.length;

    const activeOrders = orders.filter(o => o && !o.completed);
    const finishedOrders = orders.filter(o => o && o.completed);

    incomingList.innerHTML = activeOrders.length === 0
        ? '<p style="padding:10px; color:#666;">لا توجد طلبات واردة حالياً.</p>'
        : activeOrders.map(o => createOrderBoxHTML(o, false)).join('');

    if (completedList) {
        completedList.innerHTML = finishedOrders.length === 0
            ? '<p style="padding:10px; color:#666;">لا توجد طلبات مكتملة بعد.</p>'
            : finishedOrders.map(o => createOrderBoxHTML(o, true)).join('');
    }
}

function createOrderBoxHTML(o, isCompleted) {
    let itemsHtml = Array.isArray(o.items) ? o.items.map(i => i ? i.name : '').join(' ، ') : '';
    return `
        <div class="order-box" style="background:#fff; border:1px solid #ddd; padding:12px; margin-bottom:12px; border-radius:8px; position:relative;">
            <button onclick="deleteOrder('${o.id}')" title="حذف الطلب نهائياً" style="position:absolute; top:10px; left:10px; background:#e74c3c; color:#fff; border:none; width:28px; height:28px; border-radius:50%; cursor:pointer; font-weight:bold;">✕</button>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-left:30px;">
                <h4>طلب من: ${o.name || ''} (${o.phone || ''})</h4>
                <span style="font-size:0.8rem; background:#eee; padding:2px 8px; border-radius:4px;">${o.date || ''}</span>
            </div>
            <p style="margin:5px 0;"><b>العنوان:</b> ${o.address || ''}</p>
            <p style="margin:5px 0;"><b>الأجهزة:</b> ${itemsHtml}</p>
            <p style="margin:5px 0;"><b>المبلغ الكلي:</b> ${(o.total || 0).toLocaleString('ar-IQ')} د.ع</p>
            <p style="margin:5px 0;"><b>الحالة:</b> <span style="color:#e67e22; font-weight:bold;">${o.status || 'قيد المراجعة'}</span></p>

            <div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap;">
                <button class="btn-success" style="padding:4px 10px; font-size:0.85rem;" onclick="quickUpdateStatus('${o.id}', 'تمت الموافقة ✅')">موافقة</button>
                <button class="btn-danger" style="padding:4px 10px; font-size:0.85rem;" onclick="quickUpdateStatus('${o.id}', 'تم رفض الطلب ❌')">رفض</button>
                <button class="btn-gold" style="padding:4px 10px; font-size:0.85rem;" onclick="quickUpdateStatus('${o.id}', 'جاري الشحن 🚚')">شحن</button>

                ${!isCompleted ? `
                    <button class="btn-action" style="padding:4px 10px; font-size:0.85rem; background:#27ae60; color:#fff;" onclick="toggleOrderCompleted('${o.id}', true)">
                        <i class="fa-solid fa-check"></i> نقل للمكتملة
                    </button>
                ` : `
                    <button class="btn-action" style="padding:4px 10px; font-size:0.85rem; background:#7f8c8d; color:#fff;" onclick="toggleOrderCompleted('${o.id}', false)">
                        إعادة للواردة
                    </button>
                `}
            </div>
        </div>
    `;
}

function quickUpdateStatus(orderId, newStatus) {
    ordersCol.doc(orderId).update({ status: newStatus }).then(() => {
        addUserNotification(orderId, "تحديث حالة الطلب", `تم تغيير حالة طلبك إلى: (${newStatus})`);
        showNotification(`تم تغيير حالة الطلب إلى: ${newStatus}`, 'info');
    }).catch(err => console.error(err));
}

function toggleOrderCompleted(orderId, isCompleted) {
    ordersCol.doc(orderId).update({ completed: isCompleted }).then(() => {
        showNotification(isCompleted ? "تم نقل الطلب إلى قسم (الطلبات المكتملة)" : "تمت إعادة الطلب إلى الطلبات الواردة", 'success');
    }).catch(err => console.error(err));
}

function deleteOrder(orderId) {
    if (confirm("هل أنت تأكد من رغبتك في حذف هذا الطلب نهائياً؟")) {
        ordersCol.doc(orderId).delete().then(() => {
            showNotification("تم حذف الطلب بنجاح ✕", 'danger');
        }).catch(err => console.error(err));
    }
}

/* ==========================================
   إضافة وتعديل المنتجات
   ========================================== */
function handleAddProduct(e) {
    e.preventDefault();
    const name = document.getElementById('p-name').value;
    const price = parseFloat(document.getElementById('p-price').value);
    const category = document.getElementById('p-category').value;
    const descEl = document.getElementById('p-description');
    const description = descEl ? descEl.value.trim() : '';

    if (editingProductId) {
        const updateData = { name, price, category, description };
        if (tempImages.length) updateData.images = [...tempImages];

        productsCol.doc(editingProductId).update(updateData).then(() => {
            showNotification("تم تعديل المنتج بنجاح! ✏️", 'success');
            resetProductForm();
        }).catch(err => console.error(err));
    } else {
        const newProd = {
            name,
            price,
            category,
            description,
            images: tempImages.length ? [...tempImages] : ['https://via.placeholder.com/200'],
            available: true,
            order: Date.now()
        };

        productsCol.add(newProd).then(() => {
            showNotification("تمت إضافة المنتج بنجاح!", 'success');
            resetProductForm();
        }).catch(err => console.error(err));
    }
}

function startEditProduct(id) {
    const p = products.find(prod => prod && prod.id === id);
    if (!p) return;

    editingProductId = id;
    document.getElementById('p-name').value = p.name || '';
    document.getElementById('p-price').value = p.price || '';
    document.getElementById('p-category').value = p.category || categories[1] || '';

    const descEl = document.getElementById('p-description');
    if (descEl) descEl.value = p.description || '';

    tempImages = getProductImages(p);
    renderImagePreviews();

    const submitBtn = document.getElementById('save-product-btn');
    if (submitBtn) submitBtn.innerText = 'حفظ التعديلات ✏️';

    scrollToAdminPanel();
    showNotification(`أنت الآن تقوم بتعديل منتج: (${p.name})`, 'info');
}

function resetProductForm() {
    editingProductId = null;
    document.getElementById('add-product-form').reset();
    tempImages = [];
    renderImagePreviews();
    const submitBtn = document.getElementById('save-product-btn');
    if (submitBtn) submitBtn.innerText = 'إضافة المنتج';
}

/* ==========================================
   طي/إظهار قائمة المنتجات + عداد العدد
   ========================================== */
function toggleProductsListCollapse() {
    productsListCollapsed = !productsListCollapsed;
    const list = document.getElementById('admin-products-list');
    const arrow = document.getElementById('products-list-arrow');
    if (list) list.classList.toggle('hidden', productsListCollapsed);
    if (arrow) arrow.style.transform = productsListCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function renderAdminList() {
    const list = document.getElementById('admin-products-list');
    const countBadge = document.getElementById('products-count-badge');
    if (countBadge) countBadge.innerText = `(${products.length})`;
    if (!list) return;

    list.innerHTML = products.map(p => {
        if (!p) return '';
        const isAvailable = p.available !== false;
        return `
            <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px; background:#fff; padding:10px; margin-bottom:5px; border-radius:6px; align-items:center;">
                <span><b>${p.name || ''}</b> (${p.category || ''}) - ${(p.price || 0).toLocaleString('ar-IQ')} د.ع
                    <span style="font-size:0.75rem; color:${isAvailable ? 'var(--success-color)' : 'var(--danger-color)'}; font-weight:bold;">
                        ${isAvailable ? '● متوفر' : '● غير متوفر'}
                    </span>
                </span>
                <div>
                    <button class="btn-action" style="padding:3px 8px; background:#f39c12; color:#fff;" onclick="startEditProduct('${p.id}')">تعديل ✏️</button>
                    <button onclick="moveProduct('${p.id}', -1)">▲</button>
                    <button onclick="moveProduct('${p.id}', 1)">▼</button>
                    <button class="${isAvailable ? 'btn-danger' : 'btn-success'}" onclick="toggleAvailability('${p.id}')">
                        ${isAvailable ? 'إيقاف' : 'تفعيل'}
                    </button>
                    <button class="btn-danger" onclick="deleteProduct('${p.id}')">حذف</button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleAvailability(id) {
    const p = products.find(prod => prod && prod.id === id);
    if (!p) return;

    const newVal = p.available === false;
    productsCol.doc(id).update({ available: newVal }).then(() => {
        showNotification(`المنتج (${p.name}) أصبح ${newVal ? 'متوفراً ✅' : 'غير متوفر ❌'}`, newVal ? 'success' : 'danger');
    }).catch(err => console.error(err));
}

function moveProduct(id, dir) {
    const index = products.findIndex(p => p && p.id === id);
    const targetIndex = index + dir;
    if (index === -1 || targetIndex < 0 || targetIndex >= products.length) return;

    const a = products[index];
    const b = products[targetIndex];
    const aOrder = a.order ?? index;
    const bOrder = b.order ?? targetIndex;

    const batch = db.batch();
    batch.update(productsCol.doc(a.id), { order: bOrder });
    batch.update(productsCol.doc(b.id), { order: aOrder });
    batch.commit().catch(err => console.error(err));
}

function deleteProduct(id) {
    if (confirm("هل تريد حذف هذا المنتج؟")) {
        productsCol.doc(id).delete().then(() => {
            showNotification("تم حذف المنتج", 'danger');
        }).catch(err => console.error(err));
    }
}

/* ==========================================
   الدردشة المباشرة
   ========================================== */
function toggleChat() {
    const chat = document.getElementById('chat-modal');
    if (chat) chat.classList.toggle('hidden');

    const savedName = localStorage.getItem('ali_chat_customer_name');
    if (savedName) showChatInterface();

    renderUserChatModal();
}

function startChatWithName() {
    const input = document.getElementById('chat-cust-name');
    const name = input ? input.value.trim() : '';
    if (!name) {
        showNotification("الرجاء إدخال اسمك قبل بدء المحادثة", 'danger');
        return;
    }
    localStorage.setItem('ali_chat_customer_name', name);
    showChatInterface();
    renderUserChatModal();
}

function showChatInterface() {
    const gate = document.getElementById('chat-name-gate');
    const msgs = document.getElementById('chat-messages');
    const inputWrap = document.getElementById('chat-input-wrap');
    if (gate) gate.classList.add('hidden');
    if (msgs) msgs.classList.remove('hidden');
    if (inputWrap) inputWrap.classList.remove('hidden');
}

function sendUserMessage() {
    const input = document.getElementById('chat-input');
    const msgText = input ? input.value.trim() : '';
    if (!msgText) return;

    const custName = localStorage.getItem('ali_chat_customer_name') || 'زبون غير معروف';

    chatsCol.add({
        sender: 'user',
        name: custName,
        text: msgText,
        read: false,
        time: new Date().toLocaleTimeString('ar-IQ'),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        if (input) input.value = '';
    }).catch(err => console.error(err));
}

function renderUserChatModal() {
    const chatBox = document.getElementById('chat-messages');
    if (!chatBox) return;

    const custName = localStorage.getItem('ali_chat_customer_name');
    if (!custName) {
        chatBox.innerHTML = '';
        updateChatUnreadBadge();
        return;
    }

    const myMessages = chatMessages.filter(m => m && (
        (m.sender === 'user' && m.name === custName) ||
        (m.sender === 'admin' && (m.targetName === custName || !m.targetName))
    ));

    if (myMessages.length === 0) {
        chatBox.innerHTML = `<div class="msg bot-msg">أهلاً ${custName}! كيف يمكننا مساعدتك اليوم؟</div>`;
    } else {
        chatBox.innerHTML = myMessages.map(m => {
            if (!m) return '';
            const msgClass = m.sender === 'user' ? 'user-msg' : 'bot-msg';
            return `<div class="msg ${msgClass}">${m.text || ''}</div>`;
        }).join('');
    }

    chatBox.scrollTop = chatBox.scrollHeight;
    updateChatUnreadBadge();
}

function updateChatUnreadBadge() {
    const badge = document.getElementById('chat-unread-badge');
    if (!badge) return;

    const custName = localStorage.getItem('ali_chat_customer_name');
    if (!custName) {
        badge.classList.add('hidden');
        return;
    }

    const unread = chatMessages.filter(m => m && m.sender === 'admin' &&
        (m.targetName === custName || !m.targetName) && m.read === false);

    if (unread.length > 0) {
        badge.innerText = unread.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function handleChatKeyPress(e) { if (e.key === 'Enter') sendUserMessage(); }

function getChatCustomerNames() {
    const names = new Set();
    chatMessages.forEach(m => {
        if (m && m.sender === 'user' && m.name) names.add(m.name);
    });
    return Array.from(names);
}

function updateAdminChatBadge() {
    const btn = document.getElementById('admin-chat-notif-btn');
    const countEl = document.getElementById('admin-chat-notif-count');
    if (!btn || !countEl) return;

    const unread = chatMessages.filter(m => m && m.sender === 'user' && m.read === false);
    countEl.innerText = unread.length;

    if (auth.currentUser) {
        btn.classList.remove('hidden');
    }
}

function renderAdminChat() {
    const select = document.getElementById('chat-customer-select');
    const box = document.getElementById('admin-chat-messages');
    if (!select || !box) return;

    const names = getChatCustomerNames();
    const currentValue = select.value;

    select.innerHTML = '<option value="">اختر الزبون...</option>' +
        names.map(n => {
            const hasUnread = chatMessages.some(m => m && m.sender === 'user' && m.name === n && m.read === false);
            return `<option value="${n}">${hasUnread ? '🔴 ' : ''}${n}</option>`;
        }).join('');

    if (names.includes(currentValue)) {
        select.value = currentValue;
    }

    const selectedCustomer = select.value;

    if (!selectedCustomer) {
        box.innerHTML = '<p style="text-align:center; color:#777;">اختر زبوناً لعرض محادثته.</p>';
        updateAdminChatBadge();
        return;
    }

    const conversation = chatMessages.filter(m => m && (
        (m.sender === 'user' && m.name === selectedCustomer) ||
        (m.sender === 'admin' && (m.targetName === selectedCustomer || !m.targetName))
    ));

    box.innerHTML = conversation.length === 0
        ? '<p style="text-align:center; color:#777;">لا توجد رسائل بعد.</p>'
        : conversation.map(m => {
            if (!m) return '';
            const label = m.sender === 'user' ? selectedCustomer : 'المشرف';
            return `<p><b>${label}:</b> ${m.text || ''}</p>`;
        }).join('');

    box.scrollTop = box.scrollHeight;

    const unreadFromThisCustomer = chatMessages.filter(m => m && m.sender === 'user' && m.name === selectedCustomer && m.read === false);
    if (unreadFromThisCustomer.length > 0) {
        const batch = db.batch();
        unreadFromThisCustomer.forEach(m => {
            batch.update(chatsCol.doc(m.id), { read: true });
        });
        batch.commit().catch(err => console.error(err));
    }

    updateAdminChatBadge();
}

function sendAdminReply() {
    const select = document.getElementById('chat-customer-select');
    const selectedCustomer = select ? select.value : '';
    const input = document.getElementById('admin-reply-input');
    const txt = input ? input.value.trim() : '';

    if (!selectedCustomer) {
        showNotification("الرجاء اختيار الزبون قبل الرد", 'danger');
        return;
    }
    if (!txt) return;

    chatsCol.add({
        sender: 'admin',
        targetName: selectedCustomer,
        text: txt,
        read: false,
        time: new Date().toLocaleTimeString('ar-IQ'),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        if (input) input.value = '';
        showNotification("تم إرسال الرد للزبون", 'success');
    }).catch(err => console.error(err));
}

function changeThemeColor(val, type) {
    const varName = type === 'primary' ? '--primary-color' : '--secondary-color';
    document.documentElement.style.setProperty(varName, val);
    themeDoc.set({ [type]: val }, { merge: true }).catch(err => console.error(err));
}