// 1. إعدادات Firebase وتفعيل السيرفرات السريعة
const firebaseConfig = {
    // ضغ هنا بيانات إعدادات Firebase الخاصة بك
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();

// تحسين سرعة الاتصال وإلغاء بطء الشبكة
db.settings({
    experimentalAutoDetectLongPolling: true,
    experimentalForceLongPolling: true
});

// تفعيل التخزين المؤقت لجلب المنتجات فزرياً
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    console.log("Persistence status:", err.code);
});

// 2. دالة قراءة وحجم أبعاد الصور تلقائياً عند الاختيار
function checkImageDetails(event) {
    const file = event.target.files[0];
    const infoContainer = document.getElementById('image-info');

    if (!file) return;

    const fileSizeInKB = (file.size / 1024).toFixed(1);
    const fileSizeInMB = (file.size / (1024 * 1024)).toFixed(2);
    let sizeText = `${fileSizeInKB} KB`;
    let isWarning = false;

    // إظهار تحذير إذا زاد حجم الصورة عن 500KB
    if (file.size > 500 * 1024) {
        sizeText += ` (⚠️ حجم كبير! يفضل ضغطه حتى لا يبطئ المتجر)`;
        isWarning = true;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            if (infoContainer) {
                infoContainer.style.display = 'block';
                infoContainer.style.color = isWarning ? '#e74c3c' : '#27ae60';
                infoContainer.innerHTML = `
                    📐 <b>الأبعاد:</b> ${this.width} × ${this.height} بكسل <br>
                    📦 <b>الحجم:</b> ${fileSizeInMB > 1 ? fileSizeInMB + ' MB' : sizeText}
                `;
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// 3. جلب وتحميل المنتجات فوراً
function loadProducts() {
    const productsContainer = document.getElementById('products-container');
    if (productsContainer) {
        productsContainer.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding:30px;">جاري تحميل المنتجات بسرعة...</p>';
    }

    db.collection("products").get().then((querySnapshot) => {
        if (productsContainer) productsContainer.innerHTML = '';

        if (querySnapshot.empty) {
            productsContainer.innerHTML = '<p style="grid-column: 1/-1; text-align:center;">لا توجد منتجات حالياً.</p>';
            return;
        }

        querySnapshot.forEach((doc) => {
            const product = doc.data();
            renderProductCard(doc.id, product);
        });
    }).catch((error) => {
        console.error("خطأ جلب البيانات: ", error);
    });
}

// رسم كارت المنتج
function renderProductCard(id, product) {
    const productsContainer = document.getElementById('products-container');
    if (!productsContainer) return;

    const cardHtml = `
        <div class="product-card">
            <div class="product-img-wrap">
                <img src="${product.image || 'https://via.placeholder.com/200'}" alt="${product.name}" loading="lazy">
            </div>
            <div class="product-info">
                <h3>${product.name}</h3>
                <div class="price">${product.price} د.ع</div>
                <button class="btn-gold" onclick="openProductModal('${product.name}', '${product.price}', '${product.image || ''}')">
                    <i class="fa-solid fa-cart-plus"></i> إضافة للسلة
                </button>
            </div>
        </div>
    `;
    productsContainer.innerHTML += cardHtml;
}

// فتح النافذة المنبثقة
function openProductModal(name, price, image) {
    const modal = document.getElementById('product-modal');
    const details = document.getElementById('modal-details');
    details.innerHTML = `
        <img src="${image}" style="width:100%; height:200px; object-fit:cover;">
        <div style="padding:15px;">
            <h2>${name}</h2>
            <p style="color:#d4af37; font-size:1.2rem; font-weight:bold; margin:10px 0;">${price} د.ع</p>
            <button class="btn-gold">تأكيد الشراء</button>
        </div>
    `;
    modal.style.display = 'block';
}

// الأحداث والتنفيذ
document.addEventListener("DOMContentLoaded", () => {
    loadProducts();

    // ربط فحص الصورة
    const imageInput = document.getElementById('product-image');
    if (imageInput) {
        imageInput.addEventListener('change', checkImageDetails);
    }

    // إغلاق النافذة المنبثقة
    const closeBtn = document.getElementById('close-modal');
    if (closeBtn) {
        closeBtn.onclick = () => {
            document.getElementById('product-modal').style.display = 'none';
        };
    }
});
