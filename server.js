require('dotenv').config(); 
const express = require('express');
const path = require('path');
const session = require('express-session');
const sheets = require('./google-helper');

// --- (Security Libs) ---
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');

const app = express();
const PORT = process.env.PORT || 3000;

const allBranches = ['Cabang 1', 'Cabang 2', 'Cabang 3', 'Cabang 4'];
const isProduction = process.env.NODE_ENV === 'production';
const appName = "Salon Cantik"; // <--- GANTI NAMA APLIKASI ANDA DI SINI

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'))); 
app.use(express.urlencoded({ extended: true })); 

// --- (Security Middleware) ---
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET, 
  resave: false,
  saveUninitialized: false, 
  cookie: { maxAge: 1000 * 60 * 60 * 8, httpOnly: true, secure: isProduction, sameSite: 'strict'} 
}));
const csrfProtection = csurf({ cookie: true });
app.use(csrfProtection);
const sanitizeInputs = (req, res, next) => {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeHtml(req.body[key], { allowedTags: [], allowedAttributes: {} });
      }
    }
  }
  next();
};
app.use(sanitizeInputs);
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10, 
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
  standardHeaders: true, 
  legacyHeaders: false, 
});
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    res.status(403).send('Formulir tidak valid atau sesi Anda telah berakhir. Silakan kembali dan coba lagi.');
  } else {
    next(err);
  }
});

function isAdmin(req, res, next) {
  if (req.session.isAdmin && req.session.cabang) {
    next();
  } else {
    res.redirect('/login');
  }
}

// ==================
// RUTE PELANGGAN
// ==================
app.get('/', async (req, res) => {
  try {
    const packageList = await sheets.getPackageList();
    const groupedPackages = packageList.reduce((acc, pkg) => {
      const category = pkg.kategori || 'Lainnya';
      let group = acc.find(g => g.kategori === category);
      if (group) {
        group.paket.push(pkg);
      } else {
        acc.push({ kategori: category, paket: [pkg] });
      }
      return acc;
    }, []);

    res.render('form', { 
      title: 'Form Antrian Salon',
      groupedPackages: groupedPackages, 
      branches: allBranches,
      appName: appName,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    res.status(500).send("Terjadi kesalahan saat mengambil data paket.");
  }
});

// =====================================
// [DIRUBAH] API UNTUK CEK MEMBER
// =====================================
app.get('/api/check-user', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.json({ found: false });

    // Format nomor dulu
    let formatted = phone.trim().replace(/[^0-9]/g, '');
    if (formatted.startsWith('08')) formatted = '62' + formatted.substring(1);
    else if (formatted.startsWith('8')) formatted = '62' + formatted;

    // (DIRUBAH) Panggil fungsi baru yang aman
    const user = await sheets.checkUserExists(formatted);
    res.json(user); // Hanya kirim { found: true } atau { found: false }
  } catch (err) {
    console.error(err);
    res.json({ found: false });
  }
});

// =====================================
// [BARU] API UNTUK VERIFIKASI & AMBIL DATA
// =====================================
app.get('/api/get-user-data', async (req, res) => {
  try {
    const { phone, tgl_lahir } = req.query;
    if (!phone || !tgl_lahir) {
      return res.json({ success: false });
    }

    // Format nomor
    let formatted = phone.trim().replace(/[^0-9]/g, '');
    if (formatted.startsWith('08')) formatted = '62' + formatted.substring(1);
    else if (formatted.startsWith('8')) formatted = '62' + formatted;

    // (BARU) Panggil fungsi verifikasi
    const user = await sheets.verifyAndGetUser(formatted, tgl_lahir);
    res.json(user); // Kirim { success: true, nama: '...', alamat: '...' } atau { success: false }
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});


// (DIRUBAH) Rute /submit
app.post('/submit', async (req, res) => {
  try {
    const { nama, no_wa, paket, cabang, tgl_lahir, jam_datang, alamat, note } = req.body; 
    
    if (!cabang || !allBranches.includes(cabang)) {
      return res.status(400).send("Cabang tidak valid.");
    }
    let formatted_wa = no_wa.trim().replace(/[^0-9]/g, '');
    if (formatted_wa.startsWith('08')) {
      formatted_wa = '62' + formatted_wa.substring(1);
    } else if (formatted_wa.startsWith('8')) {
      formatted_wa = '62' + formatted_wa;
    }
    let paketString = Array.isArray(paket) ? paket.join(', ') : (paket || 'Tidak dipilih');
    
    const noAntrianUser = await sheets.addCustomer(
      nama, formatted_wa, paketString, 
      tgl_lahir, jam_datang, 
      alamat, 
      note || '', // (DIRUBAH) Pastikan note tidak undefined
      cabang
    );
    
    const antrianPenuh = await sheets.getFullQueue(cabang);
    const antrianBerjalan = antrianPenuh.find(q => q.status === "Melayani");
    const noAntrianSekarang = antrianBerjalan ? antrianBerjalan.no_antrian : 0;
    
    req.session.successData = {
      no_antrian_user: noAntrianUser,
      antrian_sekarang: noAntrianSekarang
    };
    res.redirect('/sukses');
  } catch (err) {
    console.error(err);
    res.status(500).send("Terjadi kesalahan saat submit data.");
  }
});

// Rute Sukses (Tidak Berubah)
app.get('/sukses', (req, res) => {
  const data = req.session.successData;
  if (!data) { return res.redirect('/'); }
  delete req.session.successData;
  res.render('success', { 
    title: 'Sukses!', 
    no_antrian_user: data.no_antrian_user,
    antrian_sekarang: data.antrian_sekarang,
    appName: appName
  });
});

// ==================
// RUTE LOGIN / LOGOUT (Tidak Berubah)
// ==================
app.get('/login', (req, res) => {
  res.render('login', { 
    title: 'Login Admin', 
    error: null,
    branches: allBranches,
    appName: appName,
    csrfToken: req.csrfToken()
  });
});
app.post('/login', loginLimiter, (req, res) => {
  const { cabang, password } = req.body;
  if (!cabang || !allBranches.includes(cabang)) {
    return res.render('login', { title: 'Login Admin', error: 'Cabang tidak valid.', branches: allBranches, appName: appName, csrfToken: req.csrfToken() });
  }
  const envKey = `ADMIN_PASS_${cabang.replace(' ', '_')}`;
  const expectedPassword = process.env[envKey];
  if (password === expectedPassword) {
    req.session.isAdmin = true;
    req.session.cabang = cabang;
    res.redirect('/admin');
  } else {
    res.render('login', { title: 'Login Admin', error: 'Password salah untuk cabang ini.', branches: allBranches, appName: appName, csrfToken: req.csrfToken() });
  }
});
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ==================
// RUTE ADMIN (DIPROTEKSI) (Tidak Berubah)
// ==================
app.get('/admin', isAdmin, async (req, res) => {
  try {
    const flash = req.session.flash;
    delete req.session.flash; 
    const currentBranch = req.session.cabang;
    const [queue, templates, packages, categories] = await Promise.all([
      sheets.getFullQueue(currentBranch),
      sheets.getWordingTemplates(),
      sheets.getPackageList(),
      sheets.getCategoryList() 
    ]);
    const current = queue.find(q => q.status === "Melayani");
    const next = queue.find(q => q.status === "Menunggu"); 
    let reminderTarget = null;
    if (next) {
      reminderTarget = queue.find(q => q.no_antrian === next.no_antrian + 1 && q.status === "Menunggu");
    }
    res.render('admin', {
      title: `Panel Admin - ${currentBranch}`,
      queue: queue,
      current: current,
      next: next,
      reminder: reminderTarget,
      templates: templates,
      packages: packages,
      categories: categories,
      flash: flash,
      currentBranch: currentBranch,
      appName: appName,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    res.status(500).send("Terjadi kesalahan saat mengambil data admin.");
  }
});
app.post('/next', isAdmin, async (req, res) => {
  try {
    const { current_antrian, next_antrian } = req.body;
    const cabang = req.session.cabang;
    if (current_antrian) {
      await sheets.updateStatus(parseInt(current_antrian), "Selesai", cabang);
    }
    if (next_antrian) {
      await sheets.updateStatus(parseInt(next_antrian), "Melayani", cabang);
    }
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send("Terjadi kesalahan saat memproses antrian.");
  }
});

// =====================================
// RUTE PENGATURAN (Tidak Berubah)
// =====================================
app.post('/admin/wording/update', isAdmin, async (req, res) => {
  try {
    const { text_panggil, text_reminder } = req.body;
    await sheets.updateWording(text_panggil, text_reminder);
    req.session.flash = { type: 'success', message: 'Teks WA berhasil disimpan!' };
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send("Gagal update teks WA.");
  }
});
app.post('/admin/paket/tambah', isAdmin, async (req, res) => {
  try {
    const { nama_paket, durasi, deskripsi, kategori } = req.body;
    if (nama_paket && durasi && deskripsi && kategori) {
      await sheets.addPackage(nama_paket, durasi, deskripsi, kategori);
      req.session.flash = { type: 'success', message: 'Paket baru berhasil ditambah!' };
    }
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send("Gagal menambah paket.");
  }
});
app.post('/admin/paket/hapus', isAdmin, async (req, res) => {
  try {
    const { nama_paket } = req.body;
    if (nama_paket) {
      await sheets.deletePackage(nama_paket);
      req.session.flash = { type: 'success', message: `Paket "${nama_paket}" berhasil dihapus.` };
    }
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send("Gagal menghapus paket.");
  }
});
app.post('/admin/paket/update', isAdmin, async (req, res) => {
  try {
    const { old_name, nama_paket, durasi, deskripsi, kategori } = req.body;
    if (old_name && nama_paket && durasi && deskripsi && kategori) {
      await sheets.updatePackage(old_name, nama_paket, durasi, deskripsi, kategori);
      req.session.flash = { type: 'success', message: `Paket "${nama_paket}" berhasil diupdate.` };
    }
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send("Gagal mengupdate paket.");
  }
});
app.post('/admin/kategori/tambah', isAdmin, async (req, res) => {
  try {
    const { nama_kategori } = req.body;
    if (nama_kategori) {
      await sheets.addCategory(nama_kategori);
      req.session.flash = { type: 'success', message: 'Kategori baru berhasil ditambah!' };
    }
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send("Gagal menambah kategori.");
  }
});
app.post('/admin/kategori/hapus', isAdmin, async (req, res) => {
  try {
    const { nama_kategori } = req.body;
    if (nama_kategori) {
      await sheets.deleteCategory(nama_kategori);
      req.session.flash = { type: 'success', message: `Kategori "${nama_kategori}" berhasil dihapus.` };
    }
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send("Gagal menghapus kategori.");
  }
});

// Jalankan server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});